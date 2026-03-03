/**
 * ArenaScene - 修罗斗场竞技场场景
 * 继承 BaseGameScene，复用引擎的等距地图、实体渲染、UI 面板
 * 通过 Go 后端 WebSocket 驱动多人对战
 */
import { BaseGameScene } from '../../prologue/scenes/BaseGameScene.js';
import { EntityFactory } from '../../ecs/EntityFactory.js';

export class ArenaScene extends BaseGameScene {
    constructor() {
        super(1, {});
        this.name = 'ArenaScene';
        
        // 竞技场状态
        this.selfId = 0;
        this.remotePlayers = new Map(); // charId -> entity
        this.campfire = { x: 400, y: 300 };
        this.arenaSize = { width: 800, height: 600 };
        this.skills = [];
        this.skillCooldowns = {};
        this.selectedTarget = null;
        
        // 网络同步
        this.lastMoveTime = 0;
        this.moveInterval = 50; // ms
        
        // WebSocket 引用（由外部注入）
        this.ws = null;
        
        // 浮动伤害文字
        this.floatingTexts = [];
        
        // 技能范围指示器
        this.skillRangeIndicators = [];
        
        // 覆盖 canvas ID（使用 engineCanvas 而非 gameCanvas）
        this.canvasId = 'engineCanvas';
    }

    /**
     * 设置 WebSocket 连接
     */
    setWebSocket(ws) {
        this.ws = ws;
    }

    /**
     * 进入场景 - 使用后端数据初始化
     * @param {Object} data - 后端 arena_state 数据
     */
    enter(data = null) {
        // 覆盖 canvas 查找逻辑
        const origGetElement = document.getElementById.bind(document);
        const canvasId = this.canvasId;
        document.getElementById = function(id) {
            if (id === 'gameCanvas') return origGetElement(canvasId);
            return origGetElement(id);
        };
        
        try {
            super.enter(data);
        } finally {
            document.getElementById = origGetElement;
        }
        
        if (data) {
            this.selfId = data.self_id;
            this.campfire = data.campfire || { x: 400, y: 300 };
            this.arenaSize = data.arena || { width: 800, height: 600 };
            this.skills = data.skills || [];
            
            // 用后端数据更新玩家位置
            if (data.players) {
                for (const p of data.players) {
                    if (p.char_id === this.selfId) {
                        this.updateSelfFromServer(p);
                    } else {
                        this.addRemotePlayer(p);
                    }
                }
            }
        }
        
        console.log('ArenaScene: 进入竞技场', this.selfId);
    }

    /**
     * 覆盖 loadActData - 竞技场不需要加载幕数据
     */
    loadActData() {
        // 不加载 ActData.json
    }

    /**
     * 覆盖 createPlayerEntity - 使用后端数据创建玩家
     */
    createPlayerEntity() {
        super.createPlayerEntity();
        // 玩家实体由 BaseGameScene 创建，后续通过 updateSelfFromServer 更新属性
    }

    /**
     * 用服务端数据更新自己的实体
     */
    updateSelfFromServer(serverData) {
        if (!this.playerEntity) return;
        
        const transform = this.playerEntity.getComponent('transform');
        if (transform) {
            transform.position.x = serverData.x;
            transform.position.y = serverData.y;
        }
        
        const stats = this.playerEntity.getComponent('stats');
        if (stats) {
            stats.hp = serverData.hp;
            stats.maxHp = serverData.max_hp;
            stats.mp = serverData.mp;
            stats.maxMp = serverData.max_mp;
            stats.attack = serverData.attack;
            stats.defense = serverData.defense;
            stats.speed = serverData.speed;
            stats.level = serverData.level;
        }
        
        const nameComp = this.playerEntity.getComponent('name');
        if (nameComp) {
            nameComp.name = serverData.name;
        }
    }

    /**
     * 添加远程玩家实体
     */
    addRemotePlayer(serverData) {
        if (this.remotePlayers.has(serverData.char_id)) return;
        
        const entity = this.entityFactory.createPlayer({
            name: serverData.name,
            class: serverData.class === 'warrior' ? 'warrior' : 'archer',
            level: serverData.level || 1,
            position: { x: serverData.x, y: serverData.y },
            stats: {
                maxHp: serverData.max_hp,
                attack: serverData.attack,
                defense: serverData.defense,
                speed: serverData.speed
            }
        });
        
        // 设置当前 HP/MP
        const stats = entity.getComponent('stats');
        if (stats) {
            stats.hp = serverData.hp;
            stats.mp = serverData.mp;
            stats.maxMp = serverData.max_mp;
        }
        
        // 标记为远程玩家
        entity.isRemote = true;
        entity.charId = serverData.char_id;
        entity.dead = serverData.dead || false;
        entity.targetX = serverData.x;
        entity.targetY = serverData.y;
        
        this.entities.push(entity);
        this.remotePlayers.set(serverData.char_id, entity);
    }

    /**
     * 移除远程玩家
     */
    removeRemotePlayer(charId) {
        const entity = this.remotePlayers.get(charId);
        if (entity) {
            const idx = this.entities.indexOf(entity);
            if (idx >= 0) this.entities.splice(idx, 1);
            this.remotePlayers.delete(charId);
        }
        if (this.selectedTarget === charId) {
            this.selectedTarget = null;
        }
    }

    /**
     * 覆盖 update - 添加网络同步逻辑
     */
    update(deltaTime) {
        // 发送移动到服务端
        this.sendMovement();
        
        // 插值远程玩家位置
        for (const [id, entity] of this.remotePlayers) {
            if (entity.targetX !== undefined) {
                const transform = entity.getComponent('transform');
                if (transform) {
                    transform.position.x += (entity.targetX - transform.position.x) * 0.3;
                    transform.position.y += (entity.targetY - transform.position.y) * 0.3;
                }
            }
        }
        
        // 更新技能范围指示器
        this.skillRangeIndicators = this.skillRangeIndicators.filter(ind => {
            ind.life -= deltaTime;
            ind.dashOffset += 60 * deltaTime;
            return ind.life > 0;
        });
        
        // 调用父类 update
        super.update(deltaTime);
    }

    /**
     * 发送移动数据到服务端
     */
    sendMovement() {
        if (!this.ws || !this.playerEntity) return;
        
        const now = Date.now();
        if (now - this.lastMoveTime < this.moveInterval) return;
        
        const transform = this.playerEntity.getComponent('transform');
        if (!transform) return;
        
        // 检测是否有移动输入
        if (!this.inputManager) return;
        const hasInput = this.inputManager.isKeyDown('w') || this.inputManager.isKeyDown('s') ||
                         this.inputManager.isKeyDown('a') || this.inputManager.isKeyDown('d') ||
                         this.inputManager.isKeyDown('arrowup') || this.inputManager.isKeyDown('arrowdown') ||
                         this.inputManager.isKeyDown('arrowleft') || this.inputManager.isKeyDown('arrowright');
        
        if (hasInput) {
            let direction = 'down';
            if (this.inputManager.isKeyDown('w') || this.inputManager.isKeyDown('arrowup')) direction = 'up';
            if (this.inputManager.isKeyDown('s') || this.inputManager.isKeyDown('arrowdown')) direction = 'down';
            if (this.inputManager.isKeyDown('a') || this.inputManager.isKeyDown('arrowleft')) direction = 'left';
            if (this.inputManager.isKeyDown('d') || this.inputManager.isKeyDown('arrowright')) direction = 'right';
            
            this.ws.send('move', {
                x: transform.position.x,
                y: transform.position.y,
                direction: direction
            });
            this.lastMoveTime = now;
        }
    }

    /**
     * 攻击选中目标
     */
    attackTarget() {
        if (!this.selectedTarget || !this.ws) return;
        const entity = this.remotePlayers.get(this.selectedTarget);
        if (!entity || entity.dead) return;
        this.ws.send('attack', { target_id: this.selectedTarget });
    }

    /**
     * 释放技能
     */
    castSkill(skillId) {
        if (!this.ws || !this.playerEntity) return;
        
        const now = Date.now();
        const cd = this.skillCooldowns[skillId];
        if (cd && now < cd) return;
        
        const transform = this.playerEntity.getComponent('transform');
        if (!transform) return;
        
        let targetX = transform.position.x;
        let targetY = transform.position.y;
        let targetId = 0;
        
        if (this.selectedTarget) {
            const target = this.remotePlayers.get(this.selectedTarget);
            if (target) {
                const tTransform = target.getComponent('transform');
                if (tTransform) {
                    targetX = tTransform.position.x;
                    targetY = tTransform.position.y;
                }
                targetId = this.selectedTarget;
            }
        }
        
        this.ws.send('cast_skill', {
            skill_id: skillId,
            target_id: targetId,
            target_x: targetX,
            target_y: targetY
        });
        
        const skill = this.skills.find(s => s.id === skillId);
        if (skill) {
            this.skillCooldowns[skillId] = now + skill.cooldown * 1000;
        }
    }

    // ===== 网络事件处理 =====

    onPlayerJoined(data) {
        this.addRemotePlayer(data);
    }

    onPlayerLeft(data) {
        this.removeRemotePlayer(data.char_id);
    }

    onPlayerMoved(data) {
        const entity = this.remotePlayers.get(data.char_id);
        if (entity) {
            entity.targetX = data.x;
            entity.targetY = data.y;
        }
    }

    onDamage(data) {
        // 更新目标 HP
        const targetEntity = data.target_id === this.selfId
            ? this.playerEntity
            : this.remotePlayers.get(data.target_id);
        
        if (targetEntity) {
            const stats = targetEntity.getComponent('stats');
            if (stats) {
                stats.hp = data.target_hp;
                stats.maxHp = data.target_max_hp;
            }
            
            // 浮动伤害文字
            const transform = targetEntity.getComponent('transform');
            if (transform && this.floatingTextManager) {
                const color = data.is_crit ? '#ffd700' : '#ff0000';
                const text = data.is_crit ? `暴击! ${Math.round(data.damage)}` : `${Math.round(data.damage)}`;
                this.floatingTextManager.addText(
                    transform.position.x,
                    transform.position.y - 20,
                    text,
                    color
                );
            }
        }
    }

    onPlayerDied(data) {
        const entity = data.char_id === this.selfId
            ? this.playerEntity
            : this.remotePlayers.get(data.char_id);
        if (entity) {
            entity.dead = true;
            const stats = entity.getComponent('stats');
            if (stats) stats.hp = 0;
        }
        if (this.floatingTextManager) {
            this.floatingTextManager.addText(400, 300, `${data.name} 被 ${data.killer} 击杀`, '#ff0000');
        }
    }

    onPlayerRespawn(data) {
        const entity = data.char_id === this.selfId
            ? this.playerEntity
            : this.remotePlayers.get(data.char_id);
        if (entity) {
            entity.dead = false;
            const transform = entity.getComponent('transform');
            if (transform) {
                transform.position.x = data.x;
                transform.position.y = data.y;
            }
            if (entity.targetX !== undefined) {
                entity.targetX = data.x;
                entity.targetY = data.y;
            }
            const stats = entity.getComponent('stats');
            if (stats) {
                stats.hp = data.hp;
                stats.maxHp = data.max_hp;
                stats.mp = data.mp;
                stats.maxMp = data.max_mp;
            }
        }
        if (this.floatingTextManager) {
            this.floatingTextManager.addText(data.x, data.y, `${data.name} 复活了`, '#00ff00');
        }
    }

    onSkillCasted(data) {
        if (data.caster_id === this.selfId && this.playerEntity) {
            const stats = this.playerEntity.getComponent('stats');
            if (stats) {
                stats.mp = data.caster_mp;
                stats.maxMp = data.caster_max_mp;
            }
        }
        
        const caster = data.caster_id === this.selfId
            ? this.playerEntity
            : this.remotePlayers.get(data.caster_id);
        if (caster) {
            const transform = caster.getComponent('transform');
            if (transform && this.floatingTextManager) {
                this.floatingTextManager.addText(
                    transform.position.x,
                    transform.position.y - 10,
                    data.skill_name,
                    '#ffab40'
                );
            }
        }
    }

    /**
     * 退出场景
     */
    exit() {
        this.remotePlayers.clear();
        this.selectedTarget = null;
        this.skillRangeIndicators = [];
        super.exit();
    }
}
