// 修罗斗场 Canvas 渲染 - 采用 prologue 等距风格
class ArenaRenderer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.players = new Map();
    this.selfId = 0;
    this.campfire = { x: 400, y: 300 };
    this.arenaSize = { width: 800, height: 600 };
    this.camera = { x: 0, y: 0 };
    this.floatingTexts = [];
    this.animFrame = 0;
    this.keys = {};
    this.lastMoveTime = 0;
    this.skills = [];
    this.skillCooldowns = {};
    this.selectedTarget = null;
    this.running = false;
    // 技能范围指示器
    this.skillRangeIndicators = [];
    // 等距网格参数
    this.tileWidth = 64;
    this.tileHeight = 32;
    // 地砖颜色
    this.TILE_COLORS = {
      grass: '#3d5c3d',
      grassAlt: '#355435',
      dirt: '#8b7355',
    };
  }

  init(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => { this.keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
  }

  resize() {
    this.canvas.width = this.canvas.parentElement.clientWidth;
    this.canvas.height = this.canvas.parentElement.clientHeight - 80;
  }

  start(state) {
    this.selfId = state.self_id;
    this.campfire = state.campfire;
    this.arenaSize = { width: state.arena.width, height: state.arena.height };
    this.skills = state.skills || [];
    this.players.clear();
    for (const p of state.players) {
      this.players.set(p.char_id, { ...p, targetX: p.x, targetY: p.y });
    }
    this.running = true;
    this.renderSkillBar();
    this.loop();
  }

  stop() {
    this.running = false;
    this.players.clear();
  }

  loop() {
    if (!this.running) return;
    this.animFrame++;
    this.update();
    this.render();
    requestAnimationFrame(() => this.loop());
  }

  update() {
    const self = this.players.get(this.selfId);
    if (!self || self.dead) return;
    const now = Date.now();
    if (now - this.lastMoveTime < 50) return;
    let dx = 0, dy = 0;
    const spd = (self.speed || 150) / 20;
    if (this.keys['w'] || this.keys['arrowup']) { dy = -spd; self.direction = 'up'; }
    if (this.keys['s'] || this.keys['arrowdown']) { dy = spd; self.direction = 'down'; }
    if (this.keys['a'] || this.keys['arrowleft']) { dx = -spd; self.direction = 'left'; }
    if (this.keys['d'] || this.keys['arrowright']) { dx = spd; self.direction = 'right'; }
    if (dx !== 0 || dy !== 0) {
      self.x = Math.max(10, Math.min(this.arenaSize.width - 10, self.x + dx));
      self.y = Math.max(10, Math.min(this.arenaSize.height - 10, self.y + dy));
      self.targetX = self.x;
      self.targetY = self.y;
      ws.send('move', { x: self.x, y: self.y, direction: self.direction });
      this.lastMoveTime = now;
    }
    for (const [id, p] of this.players) {
      if (id === this.selfId) continue;
      p.x += (p.targetX - p.x) * 0.3;
      p.y += (p.targetY - p.y) * 0.3;
    }
    this.camera.x = self.x - this.canvas.width / 2;
    this.camera.y = self.y - this.canvas.height / 2;
    this.floatingTexts = this.floatingTexts.filter(t => {
      t.y -= 1; t.life--;
      return t.life > 0;
    });
    // 更新技能范围指示器
    this.skillRangeIndicators = this.skillRangeIndicators.filter(ind => {
      ind.life -= 0.016;
      ind.dashOffset += 1;
      return ind.life > 0;
    });
  }

  render() {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 深色基底背景（prologue风格）
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 等距菱形网格
    this.renderIsometricGrid(ctx, cam);

    // 边界（虚线风格）
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(-cam.x, -cam.y, this.arenaSize.width, this.arenaSize.height);
    ctx.setLineDash([]);
    ctx.restore();

    // 火堆（prologue风格：交叉木柴 + 径向光晕）
    this.renderCampfire(ctx, cam);

    // 技能范围指示器（2.5D椭圆虚线框）
    this.renderSkillRangeIndicators(ctx, cam);

    // 玩家
    for (const [id, p] of this.players) {
      this.renderPlayer(ctx, cam, p, id === this.selfId);
    }

    // 浮动文字
    for (const t of this.floatingTexts) {
      ctx.font = `bold ${t.size || 14}px Arial`;
      ctx.fillStyle = t.color;
      ctx.globalAlpha = Math.min(1, t.life / 20);
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 3;
      ctx.fillText(t.text, t.x - cam.x, t.y - cam.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  // 等距菱形网格渲染（复用 prologue IsometricRenderer 风格）
  renderIsometricGrid(ctx, cam) {
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 100, 150, 0.3)';
    ctx.lineWidth = 1;

    const halfW = this.tileWidth / 2;
    const halfH = this.tileHeight / 2;

    // 计算可见范围的网格
    const viewLeft = cam.x - halfW;
    const viewRight = cam.x + this.canvas.width + halfW;
    const viewTop = cam.y - halfH;
    const viewBottom = cam.y + this.canvas.height + halfH;

    const minGX = Math.floor(viewLeft / this.tileWidth) - 2;
    const maxGX = Math.ceil(viewRight / this.tileWidth) + 2;
    const minGY = Math.floor(viewTop / this.tileWidth) - 2;
    const maxGY = Math.ceil(viewBottom / this.tileWidth) + 2;

    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gy = minGY; gy <= maxGY; gy++) {
        // 等距坐标转换
        const sx = (gx - gy) * halfW - cam.x;
        const sy = (gx + gy) * halfH - cam.y;

        // 判断是否在竞技场范围内，填充地砖颜色
        const worldX = gx * this.tileWidth;
        const worldY = gy * this.tileWidth;
        const inArena = worldX >= -100 && worldX <= this.arenaSize.width + 100 &&
                        worldY >= -100 && worldY <= this.arenaSize.height + 100;

        ctx.beginPath();
        ctx.moveTo(sx, sy - halfH);
        ctx.lineTo(sx + halfW, sy);
        ctx.lineTo(sx, sy + halfH);
        ctx.lineTo(sx - halfW, sy);
        ctx.closePath();

        if (inArena) {
          ctx.fillStyle = (gx + gy) % 2 === 0 ? this.TILE_COLORS.grass : this.TILE_COLORS.grassAlt;
          ctx.fill();
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 火堆渲染（复用 prologue Act1SceneECS 风格）
  renderCampfire(ctx, cam) {
    const x = this.campfire.x - cam.x;
    const y = this.campfire.y - cam.y;

    // 大范围径向光晕
    const glow = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 60);
    glow.addColorStop(0, 'rgba(255, 200, 0, 0.4)');
    glow.addColorStop(0.5, 'rgba(255, 100, 0, 0.2)');
    glow.addColorStop(1, 'rgba(255, 50, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y - 15, 60, 0, Math.PI * 2);
    ctx.fill();

    // 中心亮光
    const centerGlow = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 20);
    centerGlow.addColorStop(0, 'rgba(255, 255, 200, 0.6)');
    centerGlow.addColorStop(0.5, 'rgba(255, 150, 0, 0.3)');
    centerGlow.addColorStop(1, 'rgba(255, 100, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.beginPath();
    ctx.arc(x, y - 15, 20, 0, Math.PI * 2);
    ctx.fill();

    // 交叉木柴（prologue风格）
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 5);
    ctx.lineTo(x + 20, y - 25);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 20, y - 5);
    ctx.lineTo(x - 20, y - 25);
    ctx.stroke();

    // 动画火焰（多层，模拟帧动画效果）
    const t = this.animFrame * 0.08;
    const flicker1 = Math.sin(t) * 3;
    const flicker2 = Math.cos(t * 1.3) * 2;
    const flicker3 = Math.sin(t * 0.7 + 1) * 4;

    // 外层火焰（橙红）
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ff4400';
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 10);
    ctx.quadraticCurveTo(x - 8, y - 35 + flicker3, x, y - 45 + flicker1);
    ctx.quadraticCurveTo(x + 8, y - 35 + flicker2, x + 12, y - 10);
    ctx.closePath();
    ctx.fill();

    // 中层火焰（橙色）
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 12);
    ctx.quadraticCurveTo(x - 5, y - 30 + flicker2, x, y - 38 + flicker1);
    ctx.quadraticCurveTo(x + 5, y - 30 + flicker3, x + 8, y - 12);
    ctx.closePath();
    ctx.fill();

    // 内层火焰（黄色）
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 14);
    ctx.quadraticCurveTo(x - 3, y - 25 + flicker1, x, y - 30 + flicker2);
    ctx.quadraticCurveTo(x + 3, y - 25 + flicker3, x + 5, y - 14);
    ctx.closePath();
    ctx.fill();

    // 火焰核心（白黄）
    ctx.fillStyle = '#ffffcc';
    ctx.beginPath();
    ctx.arc(x, y - 16 + flicker1 * 0.5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 技能范围指示器渲染（复用 prologue CombatSystem 风格：2.5D椭圆虚线框）
  renderSkillRangeIndicators(ctx, cam) {
    if (this.skillRangeIndicators.length === 0) return;
    ctx.save();
    for (const ind of this.skillRangeIndicators) {
      let alpha = 1.0;
      if (ind.life < 0.5) alpha = ind.life / 0.5;

      if (ind.type === 'path') {
        // 线性路径指示器
        ctx.save();
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = ind.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -ind.dashOffset;
        const dx = ind.endX - ind.startX;
        const dy = ind.endY - ind.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          const nx = -dy / dist;
          const ny = dx / dist * 0.5; // 2.5D Y压扁
          const hw = ind.pathWidth;
          const sx = ind.startX - cam.x, sy = ind.startY - cam.y;
          const ex = ind.endX - cam.x, ey = ind.endY - cam.y;
          ctx.beginPath();
          ctx.moveTo(sx + nx * hw, sy + ny * hw);
          ctx.lineTo(ex + nx * hw, ey + ny * hw);
          ctx.lineTo(ex - nx * hw, ey - ny * hw);
          ctx.lineTo(sx - nx * hw, sy - ny * hw);
          ctx.closePath();
          ctx.stroke();
          // 终点AOE椭圆
          ctx.beginPath();
          ctx.ellipse(ex, ey, ind.endRadius, ind.endRadius * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = ind.color;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(ind.skillName, ind.endX - cam.x, ind.endY - cam.y - ind.endRadius * 0.5 - 8);
        ctx.restore();
      } else {
        // 圆形AOE指示器（2.5D椭圆）
        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = ind.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -ind.dashOffset;
        ctx.beginPath();
        ctx.ellipse(ind.x - cam.x, ind.y - cam.y, ind.radius, ind.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = ind.color;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(ind.skillName, ind.x - cam.x, ind.y - cam.y - ind.radius * 0.5 - 8);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  renderPlayer(ctx, cam, p, isSelf) {
    const px = p.x - cam.x;
    const py = p.y - cam.y;
    if (px < -50 || px > this.canvas.width + 50 || py < -50 || py > this.canvas.height + 50) return;
    const isSelected = this.selectedTarget === p.char_id;

    // 阴影（2.5D椭圆）
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(px, py + 16, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.dead) ctx.globalAlpha = 0.4;

    // 选中指示（黄色光环）
    if (isSelected && !isSelf) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(px, py + 4, 22, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 身体颜色（战士红/弓箭手青，复用 prologue ClassSelectionPanel 颜色）
    const bodyColor = p.class === 'warrior' ? '#ff6b6b' : '#4ecdc4';
    const isWalking = this.animFrame % 30 < 15;

    // 腿
    ctx.fillStyle = '#555';
    if (isWalking && !p.dead) {
      ctx.fillRect(px - 6, py + 6, 5, 10);
      ctx.fillRect(px + 1, py + 4, 5, 10);
    } else {
      ctx.fillRect(px - 5, py + 6, 4, 10);
      ctx.fillRect(px + 1, py + 6, 4, 10);
    }

    // 躯干
    ctx.fillStyle = bodyColor;
    ctx.fillRect(px - 8, py - 8, 16, 16);

    // 头
    ctx.fillStyle = '#ffd5a0';
    ctx.beginPath();
    ctx.arc(px, py - 14, 8, 0, Math.PI * 2);
    ctx.fill();

    // 武器
    if (p.class === 'warrior') {
      ctx.fillStyle = '#aaa';
      ctx.fillRect(px + 10, py - 10, 3, 18);
      ctx.fillStyle = '#ddd';
      ctx.fillRect(px + 8, py - 12, 7, 4);
    } else {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(px + 10, py - 16, 2, 22);
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px + 11, py - 5, 10, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 名字
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillStyle = isSelf ? '#ffd700' : '#fff';
    ctx.fillText(p.name, px, py - 26);
    ctx.shadowBlur = 0;

    // 血条（prologue风格：带边框和渐变）
    if (!p.dead) {
      const bw = 30, bh = 4;
      const bx = px - bw / 2, by = py - 34;
      // 背景
      ctx.fillStyle = '#333';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      // 血量
      const ratio = Math.max(0, p.hp / p.max_hp);
      if (ratio > 0.5) {
        ctx.fillStyle = '#00ff00';
      } else if (ratio > 0.25) {
        ctx.fillStyle = '#ffff00';
      } else {
        ctx.fillStyle = '#ff0000';
      }
      ctx.fillRect(bx, by, bw * ratio, bh);
      // 边框
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);
    }

    // 死亡标记
    if (p.dead) {
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = '#ff0000';
      ctx.fillText('💀', px, py);
    }
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + this.camera.x;
    const my = e.clientY - rect.top + this.camera.y;
    let closest = null;
    let closestDist = 30;
    for (const [id, p] of this.players) {
      if (id === this.selfId || p.dead) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < closestDist) { closest = id; closestDist = d; }
    }
    this.selectedTarget = closest;
  }

  attackTarget() {
    if (!this.selectedTarget) return;
    const target = this.players.get(this.selectedTarget);
    if (!target || target.dead) return;
    ws.send('attack', { target_id: this.selectedTarget });
  }

  castSkill(skillId) {
    const now = Date.now();
    const cd = this.skillCooldowns[skillId];
    if (cd && now < cd) return;
    const self = this.players.get(this.selfId);
    if (!self) return;
    let targetX = self.x, targetY = self.y;
    let targetId = 0;
    if (this.selectedTarget) {
      const t = this.players.get(this.selectedTarget);
      if (t) { targetX = t.x; targetY = t.y; targetId = this.selectedTarget; }
    }
    ws.send('cast_skill', { skill_id: skillId, target_id: targetId, target_x: targetX, target_y: targetY });
    const skill = this.skills.find(s => s.id === skillId);
    if (skill) {
      this.skillCooldowns[skillId] = now + skill.cooldown * 1000;
      this.updateSkillBarCooldowns();
      // 添加技能范围指示器
      this.addSkillRangeIndicator(skill, targetX, targetY, self);
    }
  }

  // 添加技能范围指示器（prologue CombatSystem 风格）
  addSkillRangeIndicator(skill, targetX, targetY, caster) {
    const color = skill.area_type === 'line' ? '#00ccff' : '#ff8800';
    if (skill.area_type === 'line') {
      this.skillRangeIndicators.push({
        type: 'path',
        startX: caster.x, startY: caster.y,
        endX: targetX, endY: targetY,
        pathWidth: 20,
        endRadius: skill.range * 0.3 || 30,
        color, skillName: skill.name,
        life: 1.5, dashOffset: 0
      });
    } else {
      this.skillRangeIndicators.push({
        type: 'circle',
        x: targetX, y: targetY,
        radius: skill.range || 60,
        color, skillName: skill.name,
        life: 1.5, dashOffset: 0
      });
    }
  }

  renderSkillBar() {
    const bar = document.getElementById('skill-bar');
    bar.innerHTML = '';
    this.skills.forEach((sk, i) => {
      const btn = document.createElement('div');
      btn.className = 'skill-btn';
      btn.dataset.skillId = sk.id;
      btn.innerHTML = `<div>${sk.name}</div><div class="mp-cost">MP:${sk.mp_cost}</div><div class="cd-overlay"></div>`;
      btn.addEventListener('click', () => this.castSkill(sk.id));
      bar.appendChild(btn);
    });
    window.addEventListener('keydown', (e) => {
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < this.skills.length) this.castSkill(this.skills[idx].id);
      if (e.key === ' ') { e.preventDefault(); this.attackTarget(); }
    });
    this.cdInterval = setInterval(() => this.updateSkillBarCooldowns(), 100);
  }

  updateSkillBarCooldowns() {
    const now = Date.now();
    document.querySelectorAll('.skill-btn').forEach(btn => {
      const sid = parseInt(btn.dataset.skillId);
      const cd = this.skillCooldowns[sid];
      const overlay = btn.querySelector('.cd-overlay');
      if (cd && now < cd) {
        btn.classList.add('on-cd');
        overlay.textContent = ((cd - now) / 1000).toFixed(1) + 's';
      } else {
        btn.classList.remove('on-cd');
        overlay.textContent = '';
      }
    });
  }

  addFloatingText(x, y, text, color = '#fff', size = 14) {
    this.floatingTexts.push({ x, y: y - 20, text, color, size, life: 40 });
  }

  // 网络事件处理
  onPlayerJoined(data) {
    this.players.set(data.char_id, { ...data, targetX: data.x, targetY: data.y });
  }

  onPlayerLeft(data) {
    this.players.delete(data.char_id);
    if (this.selectedTarget === data.char_id) this.selectedTarget = null;
  }

  onPlayerMoved(data) {
    const p = this.players.get(data.char_id);
    if (p) { p.targetX = data.x; p.targetY = data.y; p.direction = data.direction; }
  }

  onDamage(data) {
    const t = this.players.get(data.target_id);
    if (t) {
      t.hp = data.target_hp;
      t.max_hp = data.target_max_hp;
      const color = data.is_crit ? '#ffd700' : '#ff0000';
      const size = data.is_crit ? 18 : 14;
      const txt = data.is_crit ? `暴击! ${Math.round(data.damage)}` : `${Math.round(data.damage)}`;
      this.addFloatingText(t.x, t.y, txt, color, size);
    }
    const self = this.players.get(this.selfId);
    if (self) this.updateHUD(self);
  }

  onPlayerDied(data) {
    const p = this.players.get(data.char_id);
    if (p) p.dead = true;
    this.addFloatingText(p ? p.x : 400, p ? p.y : 300, `${data.name} 被 ${data.killer} 击杀`, '#ff0000', 16);
  }

  onPlayerRespawn(data) {
    const p = this.players.get(data.char_id);
    if (p) {
      p.dead = false;
      p.x = data.x; p.y = data.y;
      p.targetX = data.x; p.targetY = data.y;
      p.hp = data.hp; p.max_hp = data.max_hp;
      p.mp = data.mp; p.max_mp = data.max_mp;
    }
    this.addFloatingText(data.x, data.y, `${data.name} 复活了`, '#00ff00', 14);
  }

  onSkillCasted(data) {
    if (data.caster_id === this.selfId) {
      const self = this.players.get(this.selfId);
      if (self) { self.mp = data.caster_mp; self.max_mp = data.caster_max_mp; }
    }
    const caster = this.players.get(data.caster_id);
    if (caster) {
      this.addFloatingText(caster.x, caster.y - 10, data.skill_name, '#ffab40', 13);
    }
    this.updateHUD(this.players.get(this.selfId));
  }

  updateHUD(self) {
    if (!self) return;
    // 更新球形HP/MP
    const hpRatio = Math.max(0, self.hp / self.max_hp);
    const mpRatio = Math.max(0, self.mp / self.max_mp);
    const hpFill = document.querySelector('.hp-orb .hud-orb-fill');
    const hpText = document.querySelector('.hp-orb .hud-orb-text');
    const mpFill = document.querySelector('.mp-orb .hud-orb-fill');
    const mpText = document.querySelector('.mp-orb .hud-orb-text');
    if (hpFill) hpFill.style.height = `${hpRatio * 100}%`;
    if (hpText) hpText.textContent = `${Math.round(self.hp)}`;
    if (mpFill) mpFill.style.height = `${mpRatio * 100}%`;
    if (mpText) mpText.textContent = `${Math.round(self.mp)}`;
    // 同时更新条形（备用）
    const hpBar = document.querySelector('#hud-hp-bar .bar-fill');
    const hpBarText = document.querySelector('#hud-hp-bar .bar-text');
    const mpBar = document.querySelector('#hud-mp-bar .bar-fill');
    const mpBarText = document.querySelector('#hud-mp-bar .bar-text');
    if (hpBar) hpBar.style.width = `${hpRatio * 100}%`;
    if (hpBarText) hpBarText.textContent = `HP ${Math.round(self.hp)}/${Math.round(self.max_hp)}`;
    if (mpBar) mpBar.style.width = `${mpRatio * 100}%`;
    if (mpBarText) mpBarText.textContent = `MP ${Math.round(self.mp)}/${Math.round(self.max_mp)}`;
  }
}

const arena = new ArenaRenderer();
