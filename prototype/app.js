/* Recollect prototype — app.js (vanilla JS, no build step). Dummy data lives in data.js. */
(function () {
  'use strict';

  const S = window.RC_DATA;
  const INTERVALS = S.settings.intervals;          // [1, 3, 7, 21] days after learning
  const GAPS = [2, 4, 14];                          // days to the next cycle after a cold solve
  const TODAY = new Date(2026, 9, 20);              // Tue 20 Oct 2026
  S.unread = S.notifications.length;
  S.perms = S.perms || { tasks: true, qa: true, status: true, comment: true, inbox: true, revisions: true, del: false, members: false };

  /* ---------- tiny helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ic = (n, c) => `<i data-lucide="${n}"${c ? ` class="${c}"` : ''}></i>`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const addDays = n => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; };
  const fmtD = (n, o) => addDays(n).toLocaleDateString('en-GB', o || { weekday: 'short', day: 'numeric', month: 'short' });
  const dayName = n => n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n < 0 ? `${-n} days ago` : fmtD(n);
  const subj = id => S.subjects.find(s => s.id === id) || S.subjects[0];
  const M = id => S.members[id];
  const go = path => { location.hash = '#/' + path; };
  const icons = () => { if (window.lucide) window.lucide.createIcons(); };
  const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);

  function av(id, cls) {
    const m = M(id); if (!m) return '';
    if (m.agent) return `<span class="av agent ${cls || ''}" title="${m.name}">${ic('bot')}</span>`;
    if (m.bot) return `<span class="av bot ${cls || ''}" title="${m.name}">${ic('git-branch')}</span>`;
    return `<span class="av ${cls || ''}" style="--c:${m.color}" title="${m.name}">${m.initials}</span>`;
  }
  const subjPill = s => `<span class="pill" style="background:color-mix(in srgb, ${s.color} 16%, transparent);color:${s.color}">${ic(s.icon)} ${s.name}</span>`;
  const cycleDots = (n, color) => `<span class="cycle-dots" style="--c:${color || 'var(--indigo)'}">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'f' : ''}"></i>`).join('')}</span>`;

  const GRADE = {
    cold: { label: 'Solved cold', tone: 'green', icon: 'zap', key: '1' },
    hint: { label: 'Needed a hint', tone: 'amber', icon: 'lightbulb', key: '2' },
    couldnt: { label: "Couldn't", tone: 'red', icon: 'rotate-ccw', key: '3' }
  };
  function nextAfter(cycle, g) {
    if (g === 'cold') return cycle >= 4 ? { days: 30, cycle: 4, mastered: true } : { days: GAPS[cycle - 1], cycle: cycle + 1 };
    if (g === 'hint') return cycle >= 4 ? { days: 7, cycle: 4 } : { days: Math.max(1, Math.round(GAPS[cycle - 1] / 2)), cycle };
    return { days: 1, cycle: Math.max(1, cycle - 1) };
  }
  const nextText = (cycle, g) => { const n = nextAfter(cycle, g); return n.mastered ? 'mastered → monthly' : dayName(n.days); };

  /* ---------- syntax highlighting ---------- */
  const KW = {
    java: 'class|public|private|static|final|new|return|if|else|while|for|int|double|void|this|null|true|false',
    ts: 'const|let|await|async|return|if|else|throw|new|function|import|from|export|null|true|false',
    js: 'const|let|return|if|else|new|function|null|true|false',
    sql: 'CREATE|INDEX|ON|SELECT|FROM|WHERE|ORDER|BY|DESC|ASC|LIMIT|EXPLAIN|ANALYZE|AND|OR'
  };
  function hl(src, lang) {
    const comment = lang === 'sql' ? '--.*$' : '\\/\\/.*$';
    const re = new RegExp(`(${comment})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|\\b(\\d+(?:\\.\\d+)?)\\b|\\b(${KW[lang] || 'x^'})\\b|\\b([A-Za-z_]\\w*)(?=\\()`, 'gm');
    const safe = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return safe.replace(re, (m, c, s, n, k, f) =>
      c ? `<span class="tk-c">${c}</span>` : s ? `<span class="tk-s">${s}</span>` : n ? `<span class="tk-n">${n}</span>` : k ? `<span class="tk-k">${k}</span>` : `<span class="tk-f">${f}</span>`);
  }
  const LANG = { java: 'Java', ts: 'TypeScript', js: 'JavaScript', sql: 'SQL' };
  const codeBlock = c => `<div class="code"><div class="code-head"><span>${LANG[c.lang] || c.lang}</span><button class="btn btn-ghost btn-sm" data-action="copy-code">${ic('copy')} Copy</button></div><pre>${hl(c.src, c.lang)}</pre></div>`;

  /* ---------- toast ---------- */
  function toast(html, icon, tone, sub) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="t-ic ${tone || 'ok'}">${ic(icon || 'check')}</span><div>${html}${sub ? `<small>${sub}</small>` : ''}</div>`;
    $('#toasts').appendChild(el);
    icons();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 230); }, 3600);
  }

  /* ---------- revisions ---------- */
  function rate(id, g, silent) {
    const r = S.revisions.find(x => x.id === id);
    if (!r || r.done) return;
    const n = nextAfter(r.cycle, g);
    r.done = true; r.grade = g; r.revealed = false;
    r.next = n.mastered ? 'Mastered 🎉' : dayName(n.days);
    const t = S.topics.find(x => x.id === id);
    if (t) { t.last = g; t.next = n.days; t.cycle = n.cycle; if (n.mastered) t.state = 'mastered'; }
    if (!silent) {
      if (n.mastered) toast(`<b>${r.title}</b> is mastered 🎉`, 'trophy', 'ok', 'Moved to monthly check-ins');
      else toast(`${GRADE[g].label}: next revision ${n.days === 1 ? 'tomorrow' : 'on ' + fmtD(n.days)}`, GRADE[g].icon, g === 'couldnt' ? 'warn' : 'ok', g === 'couldnt' ? 'Moved back a step. No streak lost.' : `Now on cycle ${n.cycle} of 4`);
    }
  }
  function amnesty() {
    const over = S.revisions.filter(r => !r.done && r.due < 0).sort((a, b) => a.due - b.due);
    over.forEach((r, i) => { r.due = i === 0 ? 0 : i; r.spread = true; });
    S.amnestyDone = over.length;
    S.forecastAdd = [0, 1, 1, 0, 0, 0, 0];
    toast(`Spread ${over.length} overdue revisions over the next ${over.length} days`, 'calendar', 'info', 'The oldest stays today. Your streak is safe.');
  }

  /* ===================================================== VIEWS ===================================================== */

  /* ---------- Today ---------- */
  function ring(p) {
    const r = 21, c = 2 * Math.PI * r;
    return `<div class="ring"><svg viewBox="0 0 52 52"><circle class="ring-bg" cx="26" cy="26" r="${r}" fill="none" stroke-width="6"/><circle class="ring-fg" cx="26" cy="26" r="${r}" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg><b>${p}%</b></div>`;
  }
  function rateButtons(r, action) {
    return `<div class="rate">${Object.entries(GRADE).map(([g, d]) => `
      <button class="rate-btn ${g === 'couldnt' ? 'fail' : g}" data-action="${action}" data-id="${r.id}" data-grade="${g}">
        <span class="t">${ic(d.icon)} ${d.label}<kbd>${d.key}</kbd></span>
        <small>Next: ${nextText(r.cycle, g)}</small>
      </button>`).join('')}</div>`;
  }
  function revRow(r) {
    const s = subj(r.subject);
    let status;
    if (r.done) status = `<span class="pill pill-${GRADE[r.grade].tone}">${ic(GRADE[r.grade].icon)} ${GRADE[r.grade].label} · ${r.next}</span>`;
    else if (r.due < 0) status = `<span class="pill pill-red">${ic('clock')} ${-r.due}d overdue</span>`;
    else if (r.spread) status = `<span class="pill pill-indigo">${ic('calendar')} Spread · today</span>`;
    else status = `<span class="pill pill-muted">Due today</span>`;
    return `<div class="rev ${r.done ? 'is-done' : ''} ${r.revealed ? 'is-open' : ''}">
      <div class="rev-main">
        <span class="dot" style="--c:${s.color}"></span>
        <div class="rev-text">
          <a class="rev-title" href="#/topic/${r.id}">${r.title}</a>
          <div class="rev-meta">${s.name} › ${r.topic}${r.ref ? ` · ${r.ref}` : ''} · ${cycleDots(r.cycle, s.color)} Cycle ${r.cycle} of 4</div>
        </div>
        ${status}
        ${r.done ? '' : `<button class="btn btn-sm ${r.revealed ? 'btn-ghost' : ''}" data-action="reveal" data-id="${r.id}">${ic(r.revealed ? 'eye-off' : 'eye')} ${r.revealed ? 'Hide' : 'Reveal'}</button>`}
      </div>
      ${r.revealed && !r.done ? `<div class="reveal">
        <div class="reveal-hint">${ic('brain')} Tried to recall it first? Rate honestly: it decides when you'll see this again.</div>
        <ul class="points">${r.points.map(p => `<li>${p}</li>`).join('')}</ul>
        ${r.code ? codeBlock(r.code) : ''}
        ${rateButtons(r, 'rate')}
      </div>` : ''}
    </div>`;
  }
  function viewToday() {
    const over = S.revisions.filter(r => !r.done && r.due < 0);
    const today = S.revisions.filter(r => !r.done && r.due === 0);
    const done = S.revisions.filter(r => r.done);
    const tasks = S.tasks.filter(t => t.bucket === 'today' || t.bucket === 'overdue');
    const planRev = S.revisions.filter(r => r.done || r.due <= 0);
    const total = planRev.length + tasks.length;
    const completed = done.length + tasks.filter(t => t.done).length;
    const p = pct(completed, total);
    const left = over.length + today.length;
    const tab = S.todayTab || 'due';
    const mastered = S.subjects.reduce((a, s) => a + s.mastered, 0) + S.topics.filter(t => t.state === 'mastered' && t.last && S.revisions.some(r => r.id === t.id && r.done)).length;
    const fc = S.forecast.map((n, i) => i === 0 ? left : n + ((S.forecastAdd || [])[i] || 0));
    const fcMax = Math.max(...fc, 1);
    const hour = 19;

    return `
    <section class="hero">
      <div>
        <div class="eyebrow">${fmtD(0, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 class="h1">Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${S.user.name}</h1>
        <p class="sub">${left ? `${left} revision${left > 1 ? 's' : ''} and ${tasks.filter(t => !t.done).length} tasks left today. Reviews take you ~${left * 3} min.` : 'All revisions done for today. Nice work.'}</p>
      </div>
      <div class="hero-actions">
        <div class="streak">${ic('flame')} <b>${S.user.streak}</b> day streak</div>
        <a class="btn btn-primary" href="#/review" data-action="start-review">${ic('play')} Start review <kbd>R</kbd></a>
      </div>
    </section>

    <section class="stat-row">
      <div class="card stat">${ring(p)}<div><div class="stat-label">Today's plan</div><div class="stat-value">${completed}<span>/${total}</span></div><div class="stat-hint">${p >= 100 ? 'All done 🎉' : 'revisions + tasks'}</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--indigo)">${ic('repeat')}</div><div><div class="stat-label">Revisions due</div><div class="stat-value">${left}</div><div class="stat-hint">${over.length ? `<span class="down">${over.length} overdue</span>` : 'none overdue'}</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--violet)">${ic('brain')}</div><div><div class="stat-label">Recall this week</div><div class="stat-value">81%</div><div class="stat-hint"><span class="up">↑ 6%</span> solved cold or with a hint</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--amber)">${ic('trophy')}</div><div><div class="stat-label">Mastered</div><div class="stat-value">${mastered}<span> topics</span></div><div class="stat-hint"><span class="up">+3</span> this week</div></div></div>
    </section>

    <section class="grid-main">
      <div class="col">
        <div class="card">
          <div class="card-head">
            <h3>${ic('repeat')} Revisions</h3>
            <div class="right">
              <div class="seg">
                <button class="${tab === 'due' ? 'on' : ''}" data-action="today-tab" data-tab="due">Due <span class="n">${left}</span></button>
                <button class="${tab === 'done' ? 'on' : ''}" data-action="today-tab" data-tab="done">Done <span class="n">${done.length}</span></button>
              </div>
            </div>
          </div>
          ${tab === 'due' && over.length ? `<div class="banner amber">${ic('hourglass')}<div class="grow"><b>${over.length} overdue</b> from the days you were busy. <span class="muted">Spread them out instead of facing a wall of red.</span></div><button class="btn btn-sm" data-action="amnesty">${ic('calendar-days')} Spread over ${over.length} days</button></div>` : ''}
          ${tab === 'due' && S.amnestyDone && !over.length ? `<div class="banner violet">${ic('sparkles')}<div class="grow">Spread ${S.amnestyDone} overdue revisions: 1 today, the rest over the next days. <span class="muted">No streak lost.</span></div></div>` : ''}
          <div class="rev-list">
            ${tab === 'due'
              ? ([...over, ...today].map(revRow).join('') || `<div class="empty">${ic('party-popper')}<h4>All revisions done for today</h4><p class="small">Tomorrow: ${fc[1]} due. Want to <a class="link" href="#/library">learn something new</a>?</p></div>`)
              : (done.map(revRow).join('') || `<div class="empty">${ic('circle-dashed')}<h4>Nothing revised yet today</h4><p class="small">Reveal an item and rate how well you recalled it.</p></div>`)}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${ic('calendar-range')} Next 7 days</h3><div class="right"><span class="sub">${fc.reduce((a, b) => a + b, 0)} revisions scheduled</span></div></div>
          <div class="forecast">${fc.map((n, i) => `
            <div class="fc-col"><span class="fc-n">${n}</span><div class="fc-bar ${i === 0 ? 'today' : n >= 8 ? 'heavy' : ''}" style="height:${Math.max(6, (n / fcMax) * 82)}px"></div><span class="fc-d">${i === 0 ? 'Today' : fmtD(i, { weekday: 'short' })}</span></div>`).join('')}
          </div>
          <div class="fc-note">${ic('info', 'ic-sm')} Sunday looks heavy (${fc[5]}). Finish early on lighter days and Recollect pulls items forward automatically.</div>
        </div>
      </div>

      <div class="col">
        <div class="card capture">
          <div class="card-head"><h3>${ic('sparkles')} What did you learn today?</h3></div>
          <div class="card-body">
            <textarea id="cap-text" class="field" placeholder="e.g. Dijkstra breaks with negative edges. Use Bellman-Ford and detect negative cycles."></textarea>
            <div class="cap-row">
              <select id="cap-subject" class="field">${S.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
              <button class="btn btn-primary btn-sm" data-action="capture-save">${ic('plus')} Save</button>
            </div>
            <div class="cap-sched">${ic('calendar', 'ic-sm')} Revisions: ${INTERVALS.map(d => `<b>${fmtD(d, { day: 'numeric', month: 'short' })}</b>`).join(' · ')}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${ic('list-checks')} Today's tasks</h3><div class="right"><a class="link" href="#/tasks">All tasks ${ic('arrow-right', 'ic-sm')}</a></div></div>
          <div class="task-list">${tasks.map(taskRow).join('')}</div>
          <div style="height:10px"></div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${ic('briefcase')} From Nimbus Labs</h3><div class="right"><a class="link" href="#/overview">Workspace ${ic('arrow-right', 'ic-sm')}</a></div></div>
          <div class="feed-item">${av('priya')}<div class="feed-body"><b>Priya</b> failed step 4 of <b>OTP login flow</b>. <span class="agent-badge">${ic('bot')} Claude Code</span> already pushed a fix. A re-test is pending.<div style="margin-top:8px"><a class="btn btn-sm" href="#/qa/otp">${ic('flask-conical')} Open handoff</a></div></div></div>
          <div class="feed-item">${av('arjun')}<div class="feed-body"><b>Arjun</b> requested your review on <b>PR #151</b>, Payment webhook retries.<div style="margin-top:8px"><a class="btn btn-sm" href="#/board">${ic('git-pull-request')} Review</a></div></div></div>
          <div style="height:8px"></div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${ic('history')} Learned recently</h3></div>
          <div class="mini-list">${S.recentlyLearned.slice(0, 5).map(l => { const s = subj(l.subject); return `<div class="mini"><span class="dot" style="--c:${s.color}"></span><span class="grow">${l.title}</span><span class="small faint">${l.when}</span></div>`; }).join('')}</div>
          <div style="height:10px"></div>
        </div>
      </div>
    </section>`;
  }

  function taskRow(t) {
    return `<div class="task ${t.done ? 'done' : ''}">
      <button class="check ${t.done ? 'on' : ''}" data-action="task-toggle" data-id="${t.id}" aria-label="Complete task">${ic('check')}</button>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta">
          ${t.due ? `<span class="${t.bucket === 'overdue' && !t.done ? 'pri-high' : ''}">${ic('calendar', 'ic-sm')} ${t.due}</span>` : ''}
          <span class="tag hash">${t.tag}</span>
          ${t.pri === 'high' ? `<span class="pri-high">${ic('flag', 'ic-sm')} High</span>` : ''}
          ${t.ws ? `<span class="pill pill-indigo">${ic('briefcase')} ${t.ws}</span>` : ''}
          ${t.agent ? `<span class="agent-badge">${ic('bot')} via Claude Code</span>` : ''}
          ${t.topic ? `<a class="pill pill-muted" href="#/topic/${t.topic}">${ic('file-text')} Linked topic</a>` : ''}
        </div>
        ${t.note ? `<div class="small muted" style="margin-top:3px">${t.note}</div>` : ''}
      </div>
    </div>`;
  }

  /* ---------- Review session ---------- */
  function startReview() {
    S.review = { queue: S.revisions.filter(r => !r.done && r.due <= 0).map(r => r.id), idx: 0, revealed: false, results: [] };
  }
  function viewReview() {
    if (!S.review || (S.review.idx >= S.review.queue.length && !S.review.results.length)) startReview();
    const R = S.review;
    if (!R.queue.length) {
      return `<div class="card done-hero">${ic('party-popper', 'ic-lg')}<h2 style="margin-top:10px">Nothing due right now</h2><p class="sub">You've cleared today's revisions. Tomorrow has ${S.forecast[1]} waiting.</p>
        <div class="hero-actions" style="justify-content:center;margin-top:20px"><a class="btn" href="#/today">${ic('sun')} Back to Today</a><button class="btn btn-primary" data-action="review-ahead">${ic('fast-forward')} Review tomorrow's ahead</button></div></div>`;
    }
    if (R.idx >= R.queue.length) return reviewDone();
    const r = S.revisions.find(x => x.id === R.queue[R.idx]);
    const s = subj(r.subject);
    return `
    <div class="review-top">
      <a href="#/today" class="btn btn-ghost btn-sm">${ic('x')} End session</a>
      <div class="progress"><span style="width:${pct(R.idx, R.queue.length)}%"></span></div>
      <span class="small muted">${R.idx + 1} of ${R.queue.length} · ~${(R.queue.length - R.idx) * 3} min left</span>
    </div>
    <div class="review-wrap">
      <div class="card session-list">
        <div class="list-sub" style="padding:8px 10px">This session</div>
        ${R.queue.map((id, i) => {
          const x = S.revisions.find(v => v.id === id);
          const res = R.results.find(v => v.id === id);
          const st = res ? `<span class="st" style="color:var(--${GRADE[res.g].tone})">${ic(GRADE[res.g].icon, 'ic-sm')}</span>` : i === R.idx ? `<span class="st" style="color:var(--indigo)">${ic('circle-dot', 'ic-sm')}</span>` : `<span class="st faint">${ic('circle', 'ic-sm')}</span>`;
          return `<div class="session-item ${i === R.idx ? 'cur' : ''}">${st}<span class="grow">${x.title}</span></div>`;
        }).join('')}
      </div>
      <div class="card flash">
        <div class="chips">${subjPill(s)}<span class="pill pill-muted">${r.topic}</span><span class="pill pill-muted">${cycleDots(r.cycle, s.color)} Cycle ${r.cycle} of 4</span>${r.due < 0 ? `<span class="pill pill-red">${-r.due}d overdue</span>` : ''}</div>
        <h2>${r.title}</h2>
        <p class="prompt">${ic('brain')} ${r.ref && r.ref.startsWith('LeetCode') ? 'Before revealing: outline the approach and its complexity out loud, or re-solve it on LeetCode.' : 'Before revealing: explain it in two sentences as if to a teammate.'}</p>
        <div class="hidden-zone">
          <div class="${R.revealed ? '' : 'blurred'}">
            <ul class="points">${r.points.map(p => `<li>${p}</li>`).join('')}</ul>
            ${r.code ? codeBlock(r.code) : ''}
          </div>
          ${R.revealed ? '' : `<div class="cover"><div class="cover-inner"><button class="btn btn-primary" data-action="review-reveal">${ic('eye')} Reveal my notes <kbd>Space</kbd></button><p>Notes stay hidden until you've tried. That's what makes it stick.</p></div></div>`}
        </div>
        ${R.revealed ? rateButtons(r, 'review-rate') : ''}
      </div>
    </div>`;
  }
  function reviewDone() {
    const R = S.review;
    const c = g => R.results.filter(x => x.g === g).length;
    return `<div class="card done-hero">
      <div class="big">🎉</div>
      <h2 style="font-size:26px;margin-top:6px">Session complete</h2>
      <p class="sub">${R.results.length} revised in ~${R.results.length * 3} minutes. Streak is now <b>${S.user.streak + 1} days</b>.</p>
      <div class="done-stats">
        <div class="card"><div class="stat-value" style="color:var(--green)">${c('cold')}</div><div class="stat-label">Solved cold</div></div>
        <div class="card"><div class="stat-value" style="color:var(--amber)">${c('hint')}</div><div class="stat-label">Needed a hint</div></div>
        <div class="card"><div class="stat-value" style="color:var(--red)">${c('couldnt')}</div><div class="stat-label">Couldn't</div></div>
      </div>
      <div style="max-width:560px;margin:18px auto 0;text-align:left">
        ${R.results.map(x => { const r = S.revisions.find(v => v.id === x.id); return `<div class="mini"><span class="pill pill-${GRADE[x.g].tone}">${ic(GRADE[x.g].icon)} ${GRADE[x.g].label}</span><span class="grow">${r.title}</span><span class="small muted">next: ${r.next}</span></div>`; }).join('')}
      </div>
      <div class="hero-actions" style="justify-content:center;margin-top:24px">
        <a class="btn" href="#/today">${ic('sun')} Back to Today</a>
        <a class="btn" href="#/insights">${ic('trending-up')} See insights</a>
      </div>
    </div>`;
  }

  /* ---------- Library ---------- */
  function libFiltered(selId) {
    const f = S.libFilter || 'all';
    const q = (S.libQuery || '').toLowerCase().trim();
    return S.topics
      .filter(t => !selId || t.subject === selId)
      .filter(t => f === 'all' || (f === 'due' ? (t.next !== null && t.next <= 2 && t.state !== 'mastered') : t.state === f))
      .filter(t => !q || t.title.toLowerCase().includes(q) || t.group.toLowerCase().includes(q))
      .sort((a, b) => (a.next === null ? 999 : a.next) - (b.next === null ? 999 : b.next));
  }
  function topicRowHtml(t) {
    const s = subj(t.subject);
    const prog = t.state === 'mastered' ? `<span class="pill pill-green">${ic('trophy')} Mastered</span>` : t.state === 'new' ? `<span class="pill pill-muted">Not started</span>` : `${cycleDots(t.cycle, s.color)} <span class="small muted">Cycle ${t.cycle}/4</span>`;
    const nxt = t.next === null ? '<span class="faint">—</span>' : t.next < 0 ? `<span class="pill pill-red">${-t.next}d overdue</span>` : t.next === 0 ? '<span class="pill pill-indigo">Today</span>' : `<span class="small">${dayName(t.next)}</span>`;
    const last = t.last ? `<span class="pill pill-${GRADE[t.last].tone}">${GRADE[t.last].label}</span>` : '<span class="faint">—</span>';
    return `<tr data-action="open-topic" data-id="${t.id}">
      <td><div class="t-title"><span class="dot" style="--c:${s.color}"></span><div>${t.title}<div class="t-group">${t.group}</div></div></div></td>
      <td><span class="small muted">${s.name}</span></td>
      <td>${prog}</td><td>${nxt}</td><td>${last}</td></tr>`;
  }
  function libRows(selId) {
    const rows = libFiltered(selId);
    return rows.map(topicRowHtml).join('') || `<tr><td colspan="5"><div class="empty">${ic('search-x')}<h4>No topics match</h4><p class="small">Try another filter, or create a new topic.</p></div></td></tr>`;
  }
  function viewLibrary(arg) {
    const sel = arg ? subj(arg) : null;
    const base = S.topics.filter(t => !sel || t.subject === sel.id);
    const f = S.libFilter || 'all';
    const counts = {
      all: base.length,
      due: base.filter(t => t.next !== null && t.next <= 2 && t.state !== 'mastered').length,
      progress: base.filter(t => t.state === 'progress').length,
      mastered: base.filter(t => t.state === 'mastered').length,
      new: base.filter(t => t.state === 'new').length
    };
    const totalTopics = S.subjects.reduce((a, s) => a + s.total, 0);
    const totalMastered = S.subjects.reduce((a, s) => a + s.mastered, 0);
    const chip = (k, label) => `<button class="chip ${f === k ? 'on' : ''}" data-action="lib-filter" data-f="${k}">${label} <span class="n">${counts[k]}</span></button>`;
    return `
    <div class="ws-head">
      <div><div class="eyebrow">Library</div><h1 class="h1">${sel ? sel.name : 'Everything you’ve learned'}</h1><p class="sub">${sel ? `${sel.desc} · ${sel.total} topics, ${sel.mastered} mastered` : `${totalTopics} topics across ${S.subjects.length} subjects · ${totalMastered} mastered`}</p></div>
      <div class="hero-actions"><button class="btn" data-action="import-sheet">${ic('download')} Import a sheet</button><button class="btn btn-primary" data-action="new-topic" data-subject="${sel ? sel.id : 'dsa'}">${ic('plus')} New topic</button></div>
    </div>
    <div class="subject-grid">${S.subjects.map(s => {
      const on = sel && sel.id === s.id;
      const due = S.topics.filter(t => t.subject === s.id && t.next !== null && t.next <= 2 && t.state !== 'mastered').length;
      return `<a href="#/library${on ? '' : '/' + s.id}" class="card subject-card ${on ? 'on' : ''}" style="--c:${s.color}">
        <div class="subject-icon">${ic(s.icon)}</div>
        <h4>${s.name}</h4>
        <div class="small">${s.total} topics · ${due ? `<span style="color:var(--indigo);font-weight:600">${due} due soon</span>` : 'nothing due'}</div>
        <div class="progress"><span style="width:${pct(s.mastered, s.total)}%;background:${s.color}"></span><span style="width:${pct(s.progress, s.total)}%;background:color-mix(in srgb, ${s.color} 38%, transparent)"></span></div>
      </a>`;
    }).join('')}</div>
    <div class="legend" style="margin:4px 2px 18px"><span><i style="background:var(--amber)"></i>Mastered</span><span><i style="background:color-mix(in srgb, var(--amber) 38%, transparent)"></i>In progress</span><span><i style="background:var(--card-2)"></i>Not started</span></div>
    <div class="card">
      <div class="toolbar">
        <div class="chips">${chip('all', 'All')}${chip('due', 'Due soon')}${chip('progress', 'In progress')}${chip('mastered', 'Mastered')}${chip('new', 'Not started')}</div>
        <label class="search-in">${ic('search')}<input id="lib-q" placeholder="Search topics…" value="${esc(S.libQuery || '')}"></label>
      </div>
      <table class="table"><thead><tr><th>Topic</th><th>Subject</th><th>Progress</th><th>Next revision</th><th>Last recall</th></tr></thead>
        <tbody id="lib-rows">${libRows(sel && sel.id)}</tbody></table>
    </div>`;
  }
  function afterLibrary(arg) {
    const inp = $('#lib-q'); if (!inp) return;
    inp.addEventListener('input', () => { S.libQuery = inp.value; $('#lib-rows').innerHTML = libRows(arg); icons(); });
  }

  /* ---------- Topic ---------- */
  function viewTopic(id) {
    const t = S.topics.find(x => x.id === id) || S.topics[0];
    const r = S.revisions.find(x => x.id === t.id);
    const s = subj(t.subject);
    const cycle = r ? r.cycle : t.cycle;
    const dueOff = r ? r.due : t.next;

    let timeline = '';
    if (t.state === 'new' && !r) {
      timeline = `<div class="banner violet" style="margin:20px 0 14px">${ic('calendar-plus')}<div class="grow"><b>Not scheduled yet.</b> <span class="muted">Start revising and you'll see it on ${INTERVALS.map(d => fmtD(d, { day: 'numeric', month: 'short' })).join(', ')}.</span></div><button class="btn btn-sm btn-primary" data-action="topic-start" data-id="${t.id}">${ic('play')} Start revising</button></div>`;
    } else {
      const learned = (dueOff === null ? 0 : dueOff) - INTERVALS[Math.max(0, Math.min(3, cycle - 1))];
      const hist = r ? r.history : (t.state === 'mastered' ? ['cold', 'cold', 'cold', 'cold'] : Array(Math.max(0, cycle - 1)).fill(t.last || 'cold'));
      timeline = `<div class="timeline">${[1, 2, 3, 4].map(k => {
        const date = t.state === 'mastered' && !r ? fmtD(-40 + INTERVALS[k - 1] * 1, { day: 'numeric', month: 'short' }) : fmtD(learned + INTERVALS[k - 1], { day: 'numeric', month: 'short' });
        let cls = '', inner = k, label = `Day ${INTERVALS[k - 1]}`;
        if (k < cycle || t.state === 'mastered' || (r && r.done && k === cycle)) {
          const g = (r && r.done && k === cycle) ? r.grade : hist[k - 1] || 'cold';
          cls = `done ${g}`; inner = ic(GRADE[g].icon); label += ` · ${GRADE[g].label}`;
        } else if (k === cycle) { cls = 'now'; label += dueOff < 0 ? ` · ${-dueOff}d overdue` : dueOff === 0 ? ' · due today' : ` · ${dayName(dueOff)}`; }
        return `<div class="tl-node ${cls}"><div class="tl-dot">${inner}</div><div class="tl-label">${label}</div><div class="tl-date">${date}</div></div>`;
      }).join('')}</div>`;
    }

    const content = r || null;
    const B = inner => `<div class="blur-block" data-action="unblur">${inner}</div>`;
    let doc;
    if (t.id === 'median' && r) {
      doc = `
        <h2>Problem</h2>
        ${B(`<p>Given two sorted arrays <code>nums1</code> (size m) and <code>nums2</code> (size n), return the median of the two sorted arrays. The overall run time complexity should be <b>O(log (m + n))</b>.</p>`)}
        <div class="callout info">${ic('lightbulb')}<div>${B(`<b>Key insight:</b> you never merge. Find a cut that puts exactly half of all elements on the left, with every left element ≤ every right element.`)}</div></div>
        <h2>Approach</h2>
        ${B(`<ul>${r.points.map(p => `<li>${p}</li>`).join('')}</ul>`)}
        ${B(codeBlock(r.code))}
        <h2>Edge cases</h2>
        ${B(`<ul class="checklist"><li><span class="check on">${ic('check')}</span> One array empty → the median of the other</li><li><span class="check on">${ic('check')}</span> All elements of A smaller than B</li><li><span class="check">${ic('check')}</span> Duplicates across both arrays</li></ul>`)}
        <div class="callout warn">${ic('triangle-alert')}<div>${B(`<b>Mistakes I made:</b> binary-searched the <i>bigger</i> array (index out of bounds), and forgot the <code>+ 1</code> in <code>(m + n + 1) / 2</code>, which broke odd lengths.`)}</div></div>
        <h2>Related</h2>
        <div class="chips"><a class="pill pill-indigo" href="#/topic/kthlargest">${ic('at-sign')} Kth Largest Element in an Array</a><a class="pill pill-indigo" href="#/library/dsa">${ic('at-sign')} Binary search on the answer</a></div>`;
    } else if (content) {
      doc = `
        <h2>Key points</h2>
        ${B(`<ul>${content.points.map(p => `<li>${p}</li>`).join('')}</ul>`)}
        ${content.code ? B(codeBlock(content.code)) : ''}
        <div class="callout info">${ic('lightbulb')}<div>${B(`<b>Explain it like a teammate:</b> ${content.points[0].replace(/<[^>]+>/g, '')}`)}</div></div>
        <h2>Where I used it</h2>
        ${B(`<p>${content.subject === 'backend' ? 'Nimbus Labs: OTP login and the payments service.' : content.subject === 'frontend' ? 'Recollect frontend: the doc editor and the dashboard widgets.' : 'Interview prep: NeetCode 150 and mock interviews.'}</p>`)}`;
    } else {
      doc = `
        <div class="callout info">${ic('sparkles')}<div><b>This topic is still empty.</b> Paste your notes, drop a <b>photo of handwritten notes</b> (AI turns it into structured notes), or link a resource. Type <code>/</code> for blocks: code, callout, diagram, task.</div></div>
        <h2>Summary</h2><p class="faint">Write the idea in two sentences, as if explaining it to a teammate…</p>
        <h2>Key points</h2><ul class="faint"><li>…</li><li>…</li></ul>
        <h2>Example</h2><p class="faint">Code, a diagram or a worked example.</p>`;
    }

    const questions = (content && content.questions) || [
      `Explain ${t.title} in two sentences, without notes.`,
      'What is the most common mistake people make here?',
      'Where would you use this in a real project, and what’s the trade-off?'
    ];
    const history = r ? r.history.map((g, i) => ({ c: i + 1, g })) : [];
    if (r && r.done) history.push({ c: r.cycle, g: r.grade });

    return `
    <div class="topic-wrap">
      <div>
        <div class="topic-head">
          <div class="chips" style="margin:0 0 12px">${subjPill(s)}<span class="pill pill-muted">${t.group}</span>${(t.tags || []).map(x => `<span class="tag hash">${x}</span>`).join('')}${content && content.ref ? `<span class="pill pill-muted">${ic('link')} ${content.ref}</span>` : ''}</div>
          <h1 class="topic-title">${t.title}</h1>
          <div class="title-line" style="background:${s.color}"></div>
        </div>
        ${timeline}
        <div class="actionbar">
          <button class="btn btn-sm ${S.recallMode ? 'btn-primary' : ''}" data-action="topic-recall">${ic(S.recallMode ? 'eye-off' : 'eye')} Recall mode ${S.recallMode ? 'on' : 'off'}</button>
          ${r && !r.done ? `<button class="btn btn-sm" data-action="topic-mark">${ic('circle-check')} Mark revised</button>` : ''}
          <button class="btn btn-sm" data-action="topic-ai">${ic('sparkles')} Recall questions</button>
          <button class="btn btn-sm" data-action="topic-link-task">${ic('list-plus')} Link task</button>
          <button class="btn btn-sm btn-ghost" data-action="share">${ic('share-2')} Share</button>
          <span class="small muted" style="margin-left:auto">${ic('cloud', 'ic-sm')} Saved · edited ${t.edited || 'today'}</span>
        </div>
        ${S.topicRating && r && !r.done ? `<div class="inline-rate"><span class="label">How did recall go?</span>${Object.entries(GRADE).map(([g, d]) => `<button class="btn btn-sm" data-action="topic-rate" data-id="${r.id}" data-grade="${g}">${ic(d.icon)} ${d.label} <span class="faint">· ${nextText(r.cycle, g)}</span></button>`).join('')}</div>` : ''}
        ${S.topicAI ? `<div class="ai-panel"><h4>${ic('sparkles')} Recall questions, generated from your notes</h4><ol>${questions.map(q => `<li>${q}</li>`).join('')}</ol><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-sm" data-action="ai-add">${ic('plus')} Ask these during reviews</button><button class="btn btn-sm btn-ghost" data-action="topic-ai">Dismiss</button></div></div>` : ''}
        ${S.recallMode ? `<div class="banner violet" style="margin:16px 0 0">${ic('brain')}<div class="grow">Recall mode: every block is hidden. Try to remember it, then click a block to check yourself.</div></div>` : ''}
        <div class="doc ${S.recallMode ? 'recall-mode' : ''}">${doc}</div>
      </div>

      <aside class="rail">
        <div class="card">
          <div class="card-head"><h3>${ic('calendar-clock')} Revision</h3></div>
          <div class="rail-row"><span class="grow muted">Next</span><b>${r && r.done ? r.next : dueOff === null ? 'Not scheduled' : dayName(dueOff)}</b></div>
          <div class="rail-row"><span class="grow muted">Cycle</span>${cycleDots(cycle, s.color)}&nbsp;${t.state === 'mastered' ? 'Mastered' : `${cycle} of 4`}</div>
          <div class="rail-row"><span class="grow muted">Count back from</span><span class="pill pill-amber">${ic('target')} Interview · 15 Nov</span></div>
          <div class="rail-row small muted" style="padding-bottom:14px">Intervals compress so cycle 4 lands before 15 Nov.</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${ic('history')} Recall history</h3></div>
          ${history.length ? history.map(h => `<div class="rail-row"><span class="pill pill-${GRADE[h.g].tone}">${ic(GRADE[h.g].icon)} ${GRADE[h.g].label}</span><span class="grow"></span><span class="small muted">Cycle ${h.c}</span></div>`).join('') : `<div class="rail-row small muted">No reviews yet.</div>`}
          <div style="height:10px"></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${ic('link-2')} Connected</h3></div>
          <div class="rail-row">${ic('list-checks', 'ic-sm')}<span class="grow">${t.id === 'robber2' ? 'Solve 2 new DP problems' : 'No linked tasks'}</span></div>
          <div class="rail-row">${ic('at-sign', 'ic-sm')}<span class="grow">Mentioned in 2 topics</span></div>
          <div class="rail-row">${ic('bot', 'ic-sm')}<span class="grow">Claude Code can quiz you: <code>/recall ${t.id}</code></span></div>
          <div style="height:10px"></div>
        </div>
      </aside>
    </div>`;
  }

  /* ---------- Inbox ---------- */
  const CAP_ICON = { agent: 'bot', link: 'link', note: 'sticky-note', snippet: 'code', photo: 'image' };
  function viewInbox() {
    const tab = S.inboxTab || 'all';
    const list = S.captures.filter(c => tab === 'all' || c.type === tab);
    const n = t => S.captures.filter(c => c.type === t).length;
    const tabBtn = (k, label) => `<button class="${tab === k ? 'on' : ''}" data-action="inbox-tab" data-tab="${k}">${label} <span class="n">${k === 'all' ? S.captures.length : n(k)}</span></button>`;
    return `
    <div class="ws-head">
      <div><div class="eyebrow">Inbox</div><h1 class="h1">Captured, waiting to be filed</h1><p class="sub">Dump things fast, sort them later. Each one can become a topic, a revision or a task, or be archived.</p></div>
      <div class="hero-actions"><button class="btn btn-primary" data-action="capture-quick">${ic('plus')} Capture <kbd>C</kbd></button></div>
    </div>
    <div class="integ-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:20px 0">
      ${[['command', 'Ctrl K anywhere', 'Type a thought, press Enter'], ['smartphone', 'Phone share sheet', 'Share links from any app'], ['bot', 'Claude Code', '"Save this to my Recollect"'], ['scan-text', 'Photo of notes', 'AI turns handwriting into notes']].map(([i, t, d]) => `<div class="card integ" style="padding:13px 14px;gap:6px"><div class="integ-top"><div class="stat-icon" style="--c:var(--indigo);width:30px;height:30px">${ic(i, 'ic-sm')}</div><b style="font-size:13px">${t}</b></div><div class="small muted">${d}</div></div>`).join('')}
    </div>
    <div class="card">
      <div class="toolbar"><div class="seg">${tabBtn('all', 'All')}${tabBtn('agent', 'From agents')}${tabBtn('link', 'Links')}${tabBtn('note', 'Notes')}${tabBtn('snippet', 'Snippets')}${tabBtn('photo', 'Photos')}</div></div>
      ${list.map(c => {
        const s = subj(c.subject);
        return `<div class="cap-card">
          <div class="cap-type ${c.type}">${ic(CAP_ICON[c.type])}</div>
          <div class="cap-body">
            <div class="cap-title">${c.title}</div>
            <div class="cap-src">${c.type === 'agent' ? `<span class="agent-badge">${ic('bot')} Claude Code</span>` : ''}<span>${c.source}</span><span>·</span><span>${c.time}</span>${c.url ? `<span>·</span><span class="mono">${c.url}</span>` : ''}<span>·</span><span style="color:${s.color};font-weight:600">${s.name}?</span></div>
            <div class="cap-prev">${c.preview}</div>
            <div class="cap-actions">
              ${c.type === 'photo' ? `<button class="btn btn-sm btn-primary" data-action="cap-convert" data-id="${c.id}">${ic('sparkles')} Convert to notes</button>` : `<button class="btn btn-sm" data-action="cap-topic" data-id="${c.id}">${ic('file-plus')} Make topic</button>`}
              <button class="btn btn-sm" data-action="cap-sched" data-id="${c.id}">${ic('repeat')} Schedule revision</button>
              <button class="btn btn-sm" data-action="cap-task" data-id="${c.id}">${ic('list-plus')} Make task</button>
              <button class="btn btn-sm btn-ghost" data-action="cap-archive" data-id="${c.id}">${ic('archive')} Archive</button>
            </div>
          </div>
          ${c.type === 'photo' ? '<div class="photo-thumb" aria-hidden="true"></div>' : ''}
        </div>`;
      }).join('') || `<div class="empty">${ic('inbox')}<h4>Inbox zero</h4><p class="small">Everything is filed. Capture with <kbd>C</kbd> or Ctrl K.</p></div>`}
    </div>`;
  }

  /* ---------- Tasks ---------- */
  const DAYS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  function parseTask(str) {
    const out = { title: str, due: '', tag: '', pri: 'normal', bucket: 'today' };
    const tag = str.match(/#([\w-]+)/); if (tag) out.tag = tag[1];
    const pri = str.match(/!(high|urgent|low)/i); if (pri) out.pri = pri[1].toLowerCase() === 'low' ? 'low' : 'high';
    const day = str.match(/\b(today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
    const time = str.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i);
    let dayLabel = '';
    if (day) {
      const d = day[1].toLowerCase();
      dayLabel = d === 'tomorrow' ? 'Tomorrow' : (d === 'today' || d === 'tonight') ? 'Today' : DAYS[d];
      out.bucket = dayLabel === 'Today' ? 'today' : 'upcoming';
    }
    out.due = [dayLabel || (time ? 'Today' : ''), time ? time[0].toUpperCase().replace(/\s?(AM|PM)/, ' $1') : ''].filter(Boolean).join(' · ');
    out.title = str.replace(/#[\w-]+/g, '').replace(/!(high|urgent|low)/ig, '').replace(day ? day[0] : '\u0000', '').replace(time ? time[0] : '\u0000', '').replace(/\s{2,}/g, ' ').trim();
    return out;
  }
  function parsePreview(v) {
    if (!v.trim()) return `<span>Try: <b>Review PR #151 tomorrow 5pm #work !high</b></span>`;
    const p = parseTask(v);
    return `<span class="faint">Will create:</span> <b style="color:var(--fg)">${esc(p.title || '…')}</b>
      ${p.due ? `<span class="pill pill-indigo">${ic('calendar')} ${p.due}</span>` : `<span class="pill pill-muted">${ic('inbox')} No date</span>`}
      ${p.tag ? `<span class="tag hash">${esc(p.tag)}</span>` : ''}
      ${p.pri === 'high' ? `<span class="pill pill-red">${ic('flag')} High</span>` : ''}
      <span class="faint">· press Enter</span>`;
  }
  function viewTasks() {
    const f = S.taskFilter || 'all';
    const match = t => f === 'all' || (f === 'work' ? t.tag === 'work' : f === 'learning' ? ['learning', 'dsa'].includes(t.tag) : !['work'].includes(t.tag));
    const sec = (key, label, icon) => {
      const items = S.tasks.filter(t => t.bucket === key && match(t));
      if (!items.length) return '';
      return `<div class="task-section"><div class="sec-head">${ic(icon, 'ic-sm')} ${label} <span class="faint">${items.length}</span></div>${items.map(taskRow).join('')}</div>`;
    };
    const chip = (k, label) => `<button class="chip ${f === k ? 'on' : ''}" data-action="task-filter" data-f="${k}">${label}</button>`;
    return `
    <div style="max-width:860px;margin:0 auto">
      <div class="ws-head">
        <div><div class="eyebrow">Tasks</div><h1 class="h1">Your tasks</h1><p class="sub">Personal to-dos plus anything assigned to you in Nimbus Labs, all in one list.</p></div>
      </div>
      <div style="margin-top:20px">
        <label class="smart-input">${ic('circle-plus')}<input id="task-in" placeholder="Add a task… e.g. Review PR #151 tomorrow 5pm #work !high" autocomplete="off"></label>
        <div class="parse-preview" id="parse-preview">${parsePreview('')}</div>
      </div>
      <div class="chips" style="margin:16px 0 4px">${chip('all', 'All')}${chip('work', 'Work')}${chip('learning', 'Learning')}${chip('personal', 'Personal')}</div>
      <div class="card" style="margin-top:12px;padding-bottom:10px">
        ${sec('overdue', 'Overdue', 'clock')}${sec('today', 'Today', 'sun')}${sec('upcoming', 'Upcoming', 'calendar')}${sec('someday', 'Someday', 'cloud')}
      </div>
    </div>`;
  }
  function afterTasks() {
    const inp = $('#task-in'); if (!inp) return;
    inp.addEventListener('input', () => { $('#parse-preview').innerHTML = parsePreview(inp.value); icons(); });
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      const p = parseTask(inp.value);
      S.tasks.unshift({ id: 'n' + Date.now(), title: p.title || inp.value, bucket: p.bucket, due: p.due, tag: p.tag || 'personal', pri: p.pri });
      toast(`Task added: <b>${esc(p.title)}</b>`, 'circle-check', 'ok', p.due ? `Due ${p.due}${p.tag ? ' · #' + p.tag : ''}` : 'No date, filed under Today');
      rerender();
      setTimeout(() => { const i = $('#task-in'); if (i) i.focus(); }, 30);
    });
  }

  /* ---------- Insights ---------- */
  function heatmap() {
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const todayIdx = (TODAY.getDay() + 6) % 7;      // Monday = 0
    const start = -(16 * 7 + todayIdx);
    let cells = '';
    for (let i = 0; i < 17 * 7; i++) {
      const off = start + i;
      if (off > 0) { cells += '<i style="visibility:hidden"></i>'; continue; }
      let lvl;
      if (off > -12) lvl = 2 + Math.floor(rnd() * 3);
      else if (off >= -15) lvl = 0;
      else lvl = rnd() < 0.18 ? 0 : 1 + Math.floor(rnd() * 4);
      cells += `<i class="l${Math.min(4, lvl)} ${off === 0 ? 'today' : ''}" title="${fmtD(off)}: ${lvl * 3} revisions"></i>`;
    }
    return cells;
  }
  function viewInsights() {
    const rc = [[46, 30, 24], [58, 28, 14], [71, 21, 8], [84, 12, 4]];
    const weeks = [1, 2, 1, 3, 2, 4, 2, 3, 5, 3];
    const forgotten = [['Dijkstra with a min-heap', 'dsa', 3, 'dijkstra'], ['Database indexes: B-tree vs Hash', 'backend', 2, 'indexing'], ['CSS stacking contexts & z-index', 'frontend', 2, 'stacking'], ['Bit manipulation tricks', 'dsa', 2, 'bits'], ['React reconciliation & keys', 'frontend', 1, 'keys']];
    return `
    <div class="ws-head"><div><div class="eyebrow">Insights</div><h1 class="h1">How your memory is doing</h1><p class="sub">Measured by recall, not by hours. Last 30 days.</p></div>
      <div class="seg"><button>7 days</button><button class="on">30 days</button><button>90 days</button></div></div>
    <section class="stat-row">
      <div class="card stat"><div class="stat-icon" style="--c:var(--indigo)">${ic('repeat')}</div><div><div class="stat-label">Revisions done</div><div class="stat-value">142</div><div class="stat-hint"><span class="up">↑ 18%</span> vs previous 30 days</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--green)">${ic('clock')}</div><div><div class="stat-label">On time</div><div class="stat-value">78%</div><div class="stat-hint">done within 24h of due</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--amber)">${ic('flame')}</div><div><div class="stat-label">Streak</div><div class="stat-value">${S.user.streak}<span> days</span></div><div class="stat-hint">best: ${S.user.bestStreak} days</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--violet)">${ic('trophy')}</div><div><div class="stat-label">Mastered</div><div class="stat-value">33</div><div class="stat-hint"><span class="up">+11</span> this month</div></div></div>
    </section>
    <div class="grid-main">
      <div class="col">
        <div class="card"><div class="card-head"><h3>${ic('calendar-days')} Revision activity</h3><div class="right legend"><span>Less</span><span class="heat" style="grid-template-rows:13px;display:inline-grid;grid-auto-flow:column;gap:3px"><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></span><span>More</span></div></div>
          <div class="heat-wrap"><div class="heat-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div><div class="heat">${heatmap()}</div></div>
          <div class="fc-note" style="padding-top:0">${ic('info', 'ic-sm')} A 3-day gap on 5–7 Oct, then a ${S.user.streak}-day streak. Backlog amnesty spread the catch-up so you didn't drop off.</div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('brain')} Recall by cycle</h3><div class="right legend"><span><i style="background:var(--green)"></i>Cold</span><span><i style="background:var(--amber)"></i>Hint</span><span><i style="background:var(--red)"></i>Couldn't</span></div></div>
          <div class="bars-h">${rc.map((r, i) => `<div class="bar-row"><span class="muted">Cycle ${i + 1}</span><div class="progress"><span style="width:${r[0]}%;background:var(--green)"></span><span style="width:${r[1]}%;background:var(--amber)"></span><span style="width:${r[2]}%;background:var(--red)"></span></div><b>${r[0]}%</b></div>`).join('')}</div>
          <div class="fc-note" style="padding-top:0">${ic('trending-up', 'ic-sm')} Spacing works: cold recall rises from 46% at cycle 1 to 84% by cycle 4.</div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('trophy')} Topics mastered per week</h3></div>
          <div class="vbars">${weeks.map((w, i) => `<div class="vbar"><span style="height:${w * 22}px" title="${w} mastered"></span><small>W${33 + i}</small></div>`).join('')}</div><div style="height:16px"></div>
        </div>
      </div>
      <div class="col">
        <div class="card"><div class="card-head"><h3>${ic('circle-alert')} What you keep forgetting</h3></div>
          ${forgotten.map(([t, sid, n, id]) => { const s = subj(sid); return `<a class="mini" href="#/topic/${id}"><span class="dot" style="--c:${s.color}"></span><span class="grow">${t}</span><span class="pill pill-red">${n}× couldn't</span></a>`; }).join('')}
          <div style="padding:12px 20px 16px"><button class="btn btn-sm" data-action="focus-session">${ic('target')} Make a focus session from these</button></div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('layers')} By subject</h3></div>
          <div class="bars-h">${S.subjects.map(s => `<div class="bar-row" style="grid-template-columns:96px 1fr 40px"><span class="muted small">${s.name}</span><div class="progress"><span style="width:${pct(s.mastered, s.total)}%;background:${s.color}"></span><span style="width:${pct(s.progress, s.total)}%;background:color-mix(in srgb, ${s.color} 35%, transparent)"></span></div><b class="small">${pct(s.mastered, s.total)}%</b></div>`).join('')}</div>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:15px;display:flex;gap:8px;align-items:center">${ic('lightbulb')} Patterns we noticed</h3>
          <ul class="points" style="margin-top:10px">
            <li>On-time revisions are recalled cold <b>23% more often</b> than late ones.</li>
            <li>You review best <b>9–11 PM</b>, which is when 64% of your revisions happen.</li>
            <li>Graph problems are <b>2× more likely</b> to come back as "couldn't". Consider a graph sprint.</li>
          </ul>
        </div>
      </div>
    </div>`;
  }

  /* ---------- Workspace: overview ---------- */
  function feedItem(a) {
    const m = M(a.who);
    return `<div class="feed-item" ${a.link ? `data-action="go" data-to="${a.link}" style="cursor:pointer"` : ''}>
      ${av(a.who)}
      <div class="feed-body"><b>${m.name}</b>${m.agent ? ` <span class="agent-badge">for Ramin</span>` : ''} ${a.html}</div>
      <span class="feed-time">${a.time}</span></div>`;
  }
  function viewOverview() {
    const W = S.workspace;
    const n = c => S.cards.filter(x => x.col === c).length;
    const failing = S.qa.filter(q => q.status === 'failing').length;
    return `
    <div class="ws-head">
      <div><div class="eyebrow">Workspace · ${W.space}</div><h1 class="h1">${W.name}</h1><p class="sub">What changed, who's on what, and what's waiting on you, without a standup meeting.</p></div>
      <div class="hero-actions"><div class="av-stack">${['ramin', 'priya', 'arjun', 'vikram', 'neha'].map(id => av(id, 'lg')).join('')}</div><button class="btn" data-action="invite">${ic('user-plus')} Invite</button><a class="btn btn-primary" href="#/board">${ic('kanban')} Open board</a></div>
    </div>
    <div class="card sprint">
      <div class="stat-icon" style="--c:var(--indigo)">${ic('target')}</div>
      <div class="grow"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${W.sprint}</b><span class="muted">·</span><span>${W.goal}</span><span class="pill pill-amber">${ic('clock')} Ends ${W.ends}</span></div><div class="progress"><span style="width:${W.progress}%"></span></div></div>
      <div style="text-align:right"><div class="stat-value">${W.progress}%</div><div class="stat-hint">9 of 14 done</div></div>
    </div>
    <section class="stat-row">
      <div class="card stat"><div class="stat-icon" style="--c:var(--sky)">${ic('loader')}</div><div><div class="stat-label">In progress</div><div class="stat-value">${n('progress')}</div><div class="stat-hint">across 3 people</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--indigo)">${ic('git-pull-request')}</div><div><div class="stat-label">In review</div><div class="stat-value">${n('review')}</div><div class="stat-hint">1 waiting on you</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--amber)">${ic('flask-conical')}</div><div><div class="stat-label">QA testing</div><div class="stat-value">${n('qa')}</div><div class="stat-hint">${failing ? `<span class="down">${failing} failing</span>` : 'all green'}</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--green)">${ic('rocket')}</div><div><div class="stat-label">Shipped this week</div><div class="stat-value">${n('done') + 6}</div><div class="stat-hint"><span class="up">↑ 3</span> vs last week</div></div></div>
    </section>
    <div class="grid-main">
      <div class="col">
        <div class="card"><div class="card-head"><h3>${ic('activity')} Activity</h3><div class="right"><span class="agent-badge">${ic('bot')} 4 agent actions today</span></div></div>
          ${S.activity.map(feedItem).join('')}<div style="height:8px"></div></div>
      </div>
      <div class="col">
        <div class="card"><div class="card-head"><h3>${ic('hand')} Waiting on you</h3><div class="right"><span class="pill pill-red">2</span></div></div>
          <div class="mini" data-action="go" data-to="qa/otp" style="cursor:pointer">${ic('flask-conical', 'ic-sm')}<span class="grow">Re-test pending on your fix, <b>OTP login flow</b></span>${ic('chevron-right', 'ic-sm')}</div>
          <div class="mini" data-action="go" data-to="board" style="cursor:pointer">${ic('git-pull-request', 'ic-sm')}<span class="grow">Review <b>PR #151</b> for Arjun</span>${ic('chevron-right', 'ic-sm')}</div>
          <div style="height:10px"></div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('users')} Team today</h3><div class="right"><span class="sub">auto, from real work</span></div></div>
          ${S.teamToday.map(t => `<div class="team-row">${av(t.who)}<div class="grow"><div class="t1">${M(t.who).name.split(' ')[0]} <span class="muted" style="font-weight:400">· ${t.focus}</span></div><div class="t2">${t.state}</div></div></div>`).join('')}
          <div style="height:8px"></div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('flask-conical')} QA at a glance</h3><div class="right"><a class="link" href="#/qa">All ${ic('arrow-right', 'ic-sm')}</a></div></div>
          ${S.qa.map(q => { const p = q.steps.filter(s => s.result === 'pass').length; return `<a class="mini" href="#/qa/${q.id}">${statusPill(q)}<span class="grow">${q.title}</span><span class="small muted">${p}/${q.steps.length}</span></a>`; }).join('')}
          <div style="height:10px"></div>
        </div>
      </div>
    </div>`;
  }

  /* ---------- Workspace: board ---------- */
  const COL_COLOR = { backlog: 'var(--faint)', progress: 'var(--sky)', review: 'var(--indigo)', qa: 'var(--amber)', done: 'var(--green)' };
  function kcard(c) {
    const pri = { high: 'pri-high', medium: 'pri-medium', low: 'pri-low' }[c.pri];
    return `<div class="kcard" draggable="true" data-card="${c.id}" data-action="card-open" data-id="${c.id}">
      <div class="k-labels">${c.labels.map(l => `<span class="label-chip">${l}</span>`).join('')}${c.agent ? `<span class="agent-badge">${ic('bot')} Agent</span>` : ''}</div>
      <div class="k-title">${c.title}</div>
      ${c.qa ? `<div class="qa-mini">${ic('flask-conical', 'ic-sm')} QA ${c.qaDone}/${c.qaTotal}<div class="progress"><span style="width:${pct(c.qaDone, c.qaTotal)}%;--c:${c.qaDone === c.qaTotal ? 'var(--green)' : 'var(--amber)'}"></span></div></div>` : ''}
      <div class="k-foot">${c.who ? av(c.who, 'sm') : '<span class="av sm" style="--c:var(--border)">?</span>'}<span class="${pri}" title="${c.pri} priority">${ic('flag', 'ic-sm')}</span>${c.sub ? `<span>${ic('list-checks', 'ic-sm')} ${c.sub}</span>` : ''}<span class="grow"></span>${c.pr ? `<span class="mono">${c.pr}</span>` : ''}</div>
    </div>`;
  }
  function viewBoard() {
    const f = S.boardFilter || 'all';
    const show = c => f === 'all' || (f === 'mine' ? c.who === 'ramin' : c.agent);
    return `
    <div class="ws-head" style="margin-bottom:18px">
      <div><div class="eyebrow">Nimbus Labs · ${S.workspace.space}</div><h1 class="h1">Board</h1><p class="sub">Drag cards between columns. Anything moved to <b>QA testing</b> notifies Priya.</p></div>
      <div class="hero-actions">
        <div class="chips">${['all', 'mine', 'agent'].map(k => `<button class="chip ${f === k ? 'on' : ''}" data-action="board-filter" data-f="${k}">${k === 'all' ? 'All' : k === 'mine' ? 'Assigned to me' : 'Created by agents'}</button>`).join('')}</div>
        <button class="btn btn-primary" data-action="new-card">${ic('plus')} New task</button>
      </div>
    </div>
    <div class="board">${S.columns.map(col => {
      const cards = S.cards.filter(c => c.col === col.id && show(c));
      return `<div class="column" data-col="${col.id}"><div class="col-head"><span class="cdot" style="--c:${COL_COLOR[col.id]}"></span>${col.name}<span class="n">${cards.length}</span></div>${cards.map(kcard).join('')}</div>`;
    }).join('')}</div>`;
  }
  function afterBoard() {
    $$('.kcard').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.card); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
    $$('.column').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('over');
        const c = S.cards.find(x => x.id === e.dataTransfer.getData('text/plain'));
        if (!c || c.col === col.dataset.col) return;
        c.col = col.dataset.col; rerender();
        const name = S.columns.find(x => x.id === c.col).name;
        toast(`Moved <b>${c.title}</b> to ${name}`, 'arrow-right', 'info', c.col === 'qa' ? 'Priya was notified. Claude Code can draft test steps from the PR.' : c.col === 'done' ? 'Nice. It counts toward Sprint 14.' : '');
      });
    });
  }
  function openCard(id) {
    const c = S.cards.find(x => x.id === id); if (!c) return;
    const col = S.columns.find(x => x.id === c.col).name;
    openOverlay('drawer', `
      <div class="drawer-head"><span class="cdot" style="width:9px;height:9px;border-radius:50%;background:${COL_COLOR[c.col]}"></span><span class="small muted">${col}</span><button class="icon-btn" data-action="close-overlay">${ic('x')}</button></div>
      <div class="drawer-body">
        <div class="chips" style="margin-bottom:10px">${c.labels.map(l => `<span class="label-chip">${l}</span>`).join('')}${c.agent ? `<span class="agent-badge">${ic('bot')} Created by Claude Code</span>` : ''}</div>
        <h2 style="font-size:22px">${c.title}</h2>
        <div class="kv">
          <span class="k">Assignee</span><span>${c.who ? `${av(c.who, 'sm')} ${M(c.who).name}` : '<span class="muted">Unassigned</span>'}</span>
          <span class="k">Priority</span><span class="${{ high: 'pri-high', medium: 'pri-medium', low: 'pri-low' }[c.pri]}" style="font-weight:600;text-transform:capitalize">${c.pri}</span>
          ${c.pr ? `<span class="k">Pull request</span><span class="mono">${ic('git-pull-request', 'ic-sm')} ${c.pr}</span>` : ''}
          <span class="k">Sprint</span><span>${S.workspace.sprint}</span>
          ${c.qa ? `<span class="k">QA</span><span>${c.qaDone}/${c.qaTotal} steps passed · <a class="link" href="#/qa/${c.qa}">open handoff</a></span>` : ''}
        </div>
        <div class="divider"></div>
        <h3 style="font-size:14px;margin:14px 0 6px">Description</h3>
        <p class="muted" style="font-size:13.5px">${c.desc || 'No description yet. Ask Claude Code to fill it in from the branch: <code>describe this task from my changes</code>.'}</p>
        <h3 style="font-size:14px;margin:18px 0 6px">Activity</h3>
        ${c.id === 'c4' ? S.activity.slice(0, 3).map(feedItem).join('') : `<div class="feed-item" style="padding-left:0">${av(c.who || 'neha')}<div class="feed-body">created this task</div><span class="feed-time">2d</span></div>`}
      </div>
      <div class="composer"><input class="field" placeholder="Comment, or @claude to hand it to your agent…"><button class="btn btn-primary btn-sm" data-action="close-overlay">${ic('send')}</button></div>`);
  }

  /* ---------- Workspace: QA handoffs ---------- */
  function statusPill(q) {
    const map = { failing: ['red', 'circle-x', 'Failing'], ready: ['indigo', 'circle-dot', 'Ready for QA'], testing: ['amber', 'loader', 'Testing'], passed: ['green', 'circle-check', 'All steps pass'], verified: ['green', 'badge-check', 'Verified'] };
    const [tone, icon, label] = map[q.status];
    return `<span class="pill pill-${tone}">${ic(icon)} ${label}</span>`;
  }
  function recomputeQA(q) {
    if (q.status === 'verified') return;
    const r = q.steps.map(s => s.result);
    q.status = r.includes('fail') ? 'failing' : r.every(x => x === 'pass') ? 'passed' : r.some(Boolean) ? 'testing' : 'ready';
    const card = S.cards.find(c => c.qa === q.id);
    if (card) card.qaDone = r.filter(x => x === 'pass').length;
  }
  function viewQA(arg) {
    const q = S.qa.find(x => x.id === (arg || S.qaSel)) || S.qa[0];
    S.qaSel = q.id;
    const passed = q.steps.filter(s => s.result === 'pass').length;
    const creator = M(q.via);
    return `
    <div class="ws-head" style="margin-bottom:18px"><div><div class="eyebrow">Nimbus Labs · QA handoffs</div><h1 class="h1">QA handoffs</h1><p class="sub">Features handed from dev to QA, with test steps written from the actual code changes.</p></div></div>
    <div class="qa-wrap">
      <div>
        ${S.qa.map(x => { const p = x.steps.filter(s => s.result === 'pass').length; return `<a class="qa-item ${x.id === q.id ? 'on' : ''}" href="#/qa/${x.id}">
          <div class="q1">${x.title}</div>
          <div class="q2">${statusPill(x)}<span>${M(x.via).agent ? `${ic('bot', 'ic-sm')} Claude Code` : M(x.via).name}</span><span>·</span><span>${x.created}</span></div>
          <div class="progress"><span style="width:${pct(p, x.steps.length)}%;--c:${x.status === 'failing' ? 'var(--red)' : 'var(--green)'}"></span></div></a>`; }).join('')}
        <div class="card card-pad" style="margin-top:12px">
          <div class="small" style="font-weight:600;display:flex;gap:7px;align-items:center">${ic('terminal', 'ic-sm')} Created from your terminal</div>
          <p class="small muted" style="margin-top:6px">In Claude Code, say <i>"hand this feature to QA"</i>. It reads the diff, writes the steps, assigns QA and links the PR.</p>
        </div>
      </div>
      <div class="col">
        <div class="card card-pad">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="font-size:22px">${q.title}</h2>${statusPill(q)}</div>
          <div class="meta-row">${av(q.via, 'sm')}<span>${creator.agent ? '<b style="color:var(--fg)">Claude Code</b> for Ramin' : `<b style="color:var(--fg)">${creator.name}</b>`} · ${q.created}</span><span>·</span><span class="mono">${ic('git-branch', 'ic-sm')} ${q.branch}</span><span class="mono">${ic('git-pull-request', 'ic-sm')} PR ${q.pr}</span><span class="mono">${ic('git-commit-horizontal', 'ic-sm')} ${q.commit}</span></div>
          <div class="meta-row"><span>Tester</span>${av(q.tester, 'sm')}<span style="color:var(--fg)">${M(q.tester).name}</span><span>·</span><span>${ic('globe', 'ic-sm')} ${q.env}</span><span class="pill pill-muted">build ${q.build}</span></div>
        </div>
        ${q.id === 'otp' && q.status !== 'verified' ? `<div class="banner violet" style="margin:0">${ic('bot')}<div class="grow"><b>Claude Code pushed a fix</b> (<code>2a91f0e</code>) for step 4 and requested a re-test. <span class="muted">Mark step 4 again after re-testing.</span></div></div>` : ''}
        <div class="card">
          <div class="card-head"><h3>${ic('list-checks')} Test steps</h3><div class="right"><span class="sub">${passed} of ${q.steps.length} passed</span></div></div>
          <div style="padding:0 20px 12px"><div class="progress"><span style="width:${pct(passed, q.steps.length)}%;--c:var(--green)"></span></div></div>
          ${q.steps.map((s, i) => `<div class="step ${s.result || ''}">
            <span class="step-n">${s.result === 'pass' ? ic('check', 'ic-sm') : s.result === 'fail' ? ic('x', 'ic-sm') : i + 1}</span>
            <div><div class="s1">${s.text}</div><div class="s2">Expected: ${s.expected}</div>${s.result === 'fail' && s.note ? `<div class="s3">${ic('circle-alert', 'ic-sm')} ${s.note}</div>` : ''}</div>
            <div class="step-actions">
              <button class="btn btn-sm ${s.result === 'pass' ? 'pass-on' : ''}" data-action="qa-step" data-i="${i}" data-r="pass">${ic('check')} Pass</button>
              <button class="btn btn-sm ${s.result === 'fail' ? 'fail-on' : ''}" data-action="qa-step" data-i="${i}" data-r="fail">${ic('x')} Fail</button>
            </div></div>`).join('')}
          <div class="composer" style="justify-content:flex-end">
            <button class="btn" data-action="qa-sendback" ${q.status === 'verified' ? 'disabled' : ''}>${ic('undo-2')} Send back to dev</button>
            <button class="btn btn-success" data-action="qa-verify" ${q.status === 'passed' ? '' : 'disabled'}>${ic('badge-check')} Mark verified</button>
          </div>
        </div>
        <div class="grid-main" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
          <div class="card"><div class="card-head"><h3>${ic('sparkles')} What changed</h3><div class="right"><span class="agent-badge">${ic('bot')} from the diff</span></div></div><div class="card-body"><ul class="points">${q.summary.map(x => `<li>${x}</li>`).join('')}</ul></div></div>
          <div class="card"><div class="card-head"><h3>${ic('file-code')} Files</h3></div><div class="card-body files">${q.files.map(f => `<div class="file-row">${ic('file', 'ic-sm')}<span class="mono" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.path}</span><span class="add">+${f.add}</span>${f.del ? `<span class="del">−${f.del}</span>` : ''}</div>`).join('')}</div></div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('message-square')} Discussion</h3></div>
          ${q.thread.map(m => `<div class="thread-msg ${M(m.who).agent ? 'agent' : ''}">${av(m.who)}<div class="bubble"><div class="who">${M(m.who).name}${M(m.who).agent ? ' <span class="agent-badge">AI agent</span>' : ''}<span class="feed-time">${m.time}</span></div><div class="txt">${m.html}</div></div></div>`).join('')}
          <div class="composer"><input id="qa-msg" class="field" placeholder="Reply… mention @claude to send it to Ramin's agent"><button class="btn btn-primary btn-sm" data-action="qa-send">${ic('send')} Send</button></div>
        </div>
      </div>
    </div>`;
  }

  /* ---------- Workspace: agents & integrations ---------- */
  function viewAgents() {
    const P = S.perms;
    const perm = (k, t, d) => `<div class="perm"><div class="grow"><div class="p1">${t}</div><div class="p2">${d}</div></div><button class="switch ${P[k] ? 'on' : ''}" data-action="perm" data-k="${k}" aria-label="${t}"></button></div>`;
    const lines = [
      '<span class="t-dim">~/nimbus/api (feat/otp-login)</span> <span class="t-prompt">❯</span> claude',
      '<span class="t-prompt">&gt;</span> OTP login is done. Hand it to QA with test steps.',
      '<span class="t-tool">● recollect.create_qa_handoff</span>(branch: "feat/otp-login", pr: 142)',
      '  <span class="t-dim">⎿ read the diff: 4 files, +297 −1 · drafted 4 test steps</span>',
      '<span class="t-ok">✓</span> Created "OTP login flow" → assigned to Priya (QA)',
      '<span class="t-prompt">&gt;</span> Save that bcrypt explanation to my Recollect and schedule it.',
      '<span class="t-tool">● recollect.save_to_inbox</span>(subject: "Backend", schedule: true)',
      `<span class="t-ok">✓</span> Saved · revisions ${INTERVALS.map(d => fmtD(d, { day: 'numeric', month: 'short' })).join(', ')}`
    ];
    return `
    <div class="card agent-hero">
      <div>
        <span class="agent-badge">${ic('bot')} MCP · Model Context Protocol</span>
        <h1 class="h1" style="margin-top:12px">Your AI coding agent can talk to Recollect</h1>
        <p class="sub" style="font-size:14.5px">Hand features to QA, create and update tasks, or save what you just learned, straight from your terminal. Every action is logged and limited to what you allow.</p>
        <div class="flow">
          <span class="flow-node">${ic('terminal', 'ic-sm')} Claude Code</span><span class="flow-arrow">${ic('arrow-left-right')}</span>
          <span class="flow-node hl">${ic('brain', 'ic-sm')} Recollect MCP</span><span class="flow-arrow">${ic('arrow-left-right')}</span>
          <span class="flow-node">${ic('kanban', 'ic-sm')} Board · QA · Inbox</span>
        </div>
      </div>
      <div class="terminal">
        <div class="term-bar"><i style="background:#f06a6a"></i><i style="background:#f5a524"></i><i style="background:#22c38e"></i><span style="margin-left:8px">claude — nimbus/api</span></div>
        <div class="term-body">${lines.map((l, i) => `<div class="term-line" style="animation-delay:${0.25 + i * 0.45}s">${l}</div>`).join('')}</div>
      </div>
    </div>

    <div class="section-title">${ic('plug', 'ic-sm')} Connections</div>
    <div class="integ-grid">
      ${[
        ['Claude Code', 'CC', 'linear-gradient(135deg,#d97757,#b4532a)', 'Connected · last action 4 min ago · 23 actions this week', true],
        ['GitHub', 'GH', 'linear-gradient(135deg,#3a3d42,#17181a)', 'nimbus-labs org · links PRs, branches and commits', true],
        ['Cursor', 'Cu', 'linear-gradient(135deg,#4b5563,#111827)', 'Same MCP server. One click to add', false],
        ['Codex CLI', 'Cx', 'linear-gradient(135deg,#10a37f,#0b6e56)', 'Same MCP server. One click to add', false],
        ['Slack', 'Sl', 'linear-gradient(135deg,#e01e5a,#611f69)', 'QA failures and reviews in #core-platform', false],
        ['Discord', 'Dc', 'linear-gradient(135deg,#5865f2,#3c45a5)', 'Post the weekly summary to a channel', false]
      ].map(([n, l, g, d, on]) => `<div class="card integ"><div class="integ-top"><div class="integ-logo" style="background:${g}">${l}</div><div><h4>${n}</h4><div class="small">${on ? '<span style="color:var(--green);font-weight:600">● Connected</span>' : 'Available'}</div></div></div><div class="small">${d}</div><div class="foot">${on ? `<button class="btn btn-sm btn-ghost" data-action="toast" data-msg="Opened ${n} settings">${ic('settings')} Manage</button>` : `<button class="btn btn-sm" data-action="connect" data-name="${n}">${ic('plus')} Connect</button>`}</div></div>`).join('')}
    </div>

    <div class="grid-main" style="margin-top:20px">
      <div class="col">
        <div class="card">
          <div class="card-head"><h3>${ic('terminal')} Set up Claude Code in 1 minute</h3></div>
          <div class="steps-num">
            <div><div><div class="s-t">Add the Recollect MCP server</div><div class="snippet"><code id="mcp-cmd">claude mcp add --transport http recollect https://api.re-collect.in/mcp</code><button class="btn btn-sm" data-action="copy-cmd">${ic('copy')} Copy</button></div></div></div>
            <div><div><div class="s-t">Sign in when Claude Code asks</div><p class="small muted">The browser opens and you approve access to <b>Nimbus Labs</b>, using the permissions on the right.</p></div></div>
            <div><div><div class="s-t">Just ask</div><div class="chips" style="margin-top:4px"><span class="tag">"hand this feature to QA"</span><span class="tag">"what's assigned to me today?"</span><span class="tag">"save this to my Recollect"</span><span class="tag">"quiz me on what's due"</span></div></div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${ic('scroll-text')} Agent activity log</h3><div class="right"><span class="sub">every action, auditable</span></div></div>
          <table class="table"><thead><tr><th>Time</th><th>Action</th><th>Target</th><th>On behalf of</th></tr></thead><tbody>
            ${S.agentLog.map(a => `<tr style="cursor:default"><td class="small muted">${a.time}</td><td><span class="mono" style="color:var(--violet)">${a.action}</span></td><td class="small">${a.target}</td><td>${av('ramin', 'sm')}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>
      <div class="col">
        <div class="card">
          <div class="card-head"><h3>${ic('shield-check')} What agents may do</h3></div>
          ${perm('tasks', 'Create tasks', 'In spaces you belong to')}
          ${perm('qa', 'Create QA handoffs', 'With steps drafted from the diff')}
          ${perm('status', 'Move tasks between columns', 'e.g. In progress → In review')}
          ${perm('comment', 'Comment and reply', 'Clearly marked as written by an agent')}
          ${perm('inbox', 'Save to my Inbox', 'Personal: learnings, snippets')}
          ${perm('revisions', 'Read my due revisions', 'For "quiz me on what’s due"')}
          ${perm('del', 'Delete tasks', 'Off by default')}
          ${perm('members', 'Manage members and roles', 'Never allowed for agents in v1')}
        </div>
      </div>
    </div>`;
  }

  /* ---------- Groups (preview) ---------- */
  function viewGroups() {
    const C = S.cohort;
    const heat = v => `background:color-mix(in srgb, var(--red) ${Math.min(85, v * 1.5)}%, var(--card-2))`;
    return `
    <div class="preview-banner">${ic('flask-conical')}<div><b>Preview, not in v1.</b> <span class="muted">"Revision Cohorts" from the discovery sprint. It gets built only if hand-run pilots hit the continue numbers.</span></div></div>
    <div class="ws-head">
      <div><div class="eyebrow">Study group · led by you</div><h1 class="h1">${C.name}</h1><p class="sub">${C.sheet} · each member gets their own revision schedule from the shared sheet.</p></div>
      <div class="hero-actions"><button class="btn" data-action="toast" data-msg="Invite link copied: members join with their own schedule">${ic('link')} Invite link</button><button class="btn btn-primary" data-action="toast" data-msg="Weekly summary posted to Discord #dsa-sprint">${ic('send')} Post weekly summary</button></div>
    </div>
    <section class="stat-row">
      <div class="card stat"><div class="stat-icon" style="--c:var(--indigo)">${ic('calendar-days')}</div><div><div class="stat-label">Sprint</div><div class="stat-value">Day ${C.day}<span>/${C.days}</span></div><div class="progress" style="margin-top:6px;width:120px"><span style="width:${pct(C.day, C.days)}%"></span></div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--green)">${ic('users')}</div><div><div class="stat-label">Active this week</div><div class="stat-value">${C.active}<span>/${C.members}</span></div><div class="stat-hint">≥3 revisions</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--amber)">${ic('clock')}</div><div><div class="stat-label">On-time revisions</div><div class="stat-value">${C.onTime}%</div><div class="stat-hint">group average</div></div></div>
      <div class="card stat"><div class="stat-icon" style="--c:var(--violet)">${ic('brain')}</div><div><div class="stat-label">Solved cold</div><div class="stat-value">${C.coldRate}%</div><div class="stat-hint"><span class="up">↑ 9%</span> since day 1</div></div></div>
    </section>
    <div class="grid-main">
      <div class="col">
        <div class="card"><div class="card-head"><h3>${ic('brain')} What the batch keeps forgetting</h3><div class="right"><span class="sub">% of "couldn't" by week</span></div></div>
          <div class="forget-grid"><span class="h">Topic</span>${['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'].map(w => `<span class="h">${w}</span>`).join('')}
            ${C.forgets.map(f => `<span>${f.topic}</span>${f.w.map(v => `<span class="fcell" style="${heat(v)}">${v}%</span>`).join('')}`).join('')}
          </div>
          <div class="fc-note" style="padding-top:0">${ic('lightbulb', 'ic-sm')} Dijkstra is getting worse week over week. Cover it in Saturday's session.</div>
        </div>
        <div class="card"><div class="card-head"><h3>${ic('message-square')} Weekly summary preview</h3><div class="right"><span class="sub">${C.channel}</span></div></div>
          <div class="card-body"><div class="discord"><div class="d-head"><span class="av sm agent">${ic('bot')}</span><span class="d-name">Recollect</span><span class="d-bot">APP</span><span class="small" style="opacity:.6">Today at 8:00 PM</span></div>
            <div class="d-embed"><b>Week 2 · DSA Placement Sprint</b><br>✅ 71% of revisions on time (↑ 8%)<br>🧠 Most forgotten: <b>Dijkstra</b>, <b>Interval DP</b>, <b>Trie</b><br>🔥 19 of 24 active. Let's get everyone in this week.</div></div></div>
        </div>
      </div>
      <div class="col">
        <div class="card"><div class="card-head"><h3>${ic('hand')} Needs a nudge</h3><div class="right"><span class="pill pill-muted">${ic('lock')} private</span></div></div>
          ${C.nudge.map(n => `<div class="team-row"><span class="av" style="--c:var(--faint)">${n.name.split(' ').map(x => x[0]).join('')}</span><div class="grow"><div class="t1">${n.name}</div><div class="t2">Last active ${n.last} · ${n.due} revisions waiting</div></div><button class="btn btn-sm" data-action="toast" data-msg="Friendly nudge sent to ${n.name}">${ic('send')} Nudge</button></div>`).join('')}
          <div style="height:8px"></div>
        </div>
        <div class="card card-pad"><h3 style="font-size:14.5px;display:flex;gap:8px;align-items:center">${ic('shield-check')} Fair by design</h3>
          <ul class="points" style="margin-top:10px"><li>Members see exactly what leaders see.</li><li>Personal notes are never shared, only progress on the shared sheet.</li><li>No public rankings or bottom-of-the-list shaming. Adults only.</li></ul></div>
      </div>
    </div>`;
  }

  /* ---------- Settings ---------- */
  function viewSettings() {
    const T = S.settings.toggles;
    const sw = (k) => `<button class="switch ${T[k] ? 'on' : ''}" data-action="setting" data-k="${k}"></button>`;
    const theme = document.documentElement.dataset.theme;
    const row = (t, d, ctl) => `<div class="set-row"><div class="grow"><div class="r1">${t}</div><div class="r2">${d}</div></div>${ctl}</div>`;
    const nav = [['profile', 'user', 'Profile'], ['revision', 'repeat', 'Revision engine'], ['notifications', 'bell', 'Notifications'], ['appearance', 'palette', 'Appearance'], ['data', 'database', 'Data & privacy']];
    return `
    <div class="ws-head" style="margin-bottom:22px"><div><div class="eyebrow">Settings</div><h1 class="h1">Settings</h1></div></div>
    <div class="settings-wrap">
      <nav class="settings-nav">${nav.map(([id, i, l], k) => `<button class="nav-item ${k === 0 ? 'active' : ''}" data-action="scroll-to" data-target="set-${id}">${ic(i)}<span>${l}</span></button>`).join('')}</nav>
      <div class="col">
        <div class="card" id="set-profile"><div class="card-head"><h3>${ic('user')} Profile</h3></div>
          ${row('Name', 'Shown to your workspace', `<input class="field" style="width:240px" value="${S.user.name}">`)}
          ${row('Email', 'Sign-in and digests', `<input class="field" style="width:240px" value="${S.user.email}">`)}
          ${row('Timezone', 'Decides when your day starts and ends', `<select class="field" style="width:240px"><option>${S.user.tz}</option><option>UTC</option><option>Europe/London</option></select>`)}
        </div>
        <div class="card" id="set-revision"><div class="card-head"><h3>${ic('repeat')} Revision engine</h3></div>
          ${row('Intervals', 'Days after learning. Change them per subject if you like.', `<div>${INTERVALS.map((d, i) => `<span class="int-chip">${d}d</span>${i < INTERVALS.length - 1 ? '<span class="int-arrow">→</span>' : ''}`).join('')}</div>`)}
          ${row('Count back from a target date', 'Compress the intervals so the last revision lands before an interview or exam', sw('countBack'))}
          ${row('Backlog amnesty', 'When you fall behind, spread the overdue items over this many days', `<select class="field" style="width:110px"><option>3 days</option><option>5 days</option><option>7 days</option></select>`)}
          ${row('Daily goal', 'Revisions per day before the ring fills', `<select class="field" style="width:110px"><option>8</option><option>5</option><option>12</option></select>`)}
        </div>
        <div class="card" id="set-notifications"><div class="card-head"><h3>${ic('bell')} Notifications</h3></div>
          ${row('Daily digest', `Email at ${S.settings.digestTime}: what's due today`, sw('digest'))}
          ${row('Push reminders', 'From the installed app (PWA)', sw('push'))}
          ${row('Overdue nudge', 'One gentle nudge if you skip a day', sw('overdue'))}
          ${row('Workspace mentions', '@you in tasks, QA or comments', sw('mentions'))}
          ${row('QA results', 'When a handoff you own passes or fails', sw('qaResults'))}
          ${row('Weekly report', 'Sunday evening: recall, streaks and forgotten topics', sw('weekly'))}
        </div>
        <div class="card" id="set-appearance"><div class="card-head"><h3>${ic('palette')} Appearance</h3></div>
          <div class="set-row"><div class="grow"><div class="r1">Theme</div><div class="r2">Graphite dark is the default</div></div>
            <div style="display:flex;gap:10px">
              <div class="theme-opt ${theme === 'dark' ? 'on' : ''}" data-action="set-theme" data-v="dark"><div class="theme-swatch" style="background:#222324"><i style="width:30%;background:#1c1d1e"></i><i style="flex:1;background:#28292b"></i></div>Graphite</div>
              <div class="theme-opt ${theme === 'light' ? 'on' : ''}" data-action="set-theme" data-v="light"><div class="theme-swatch" style="background:#fafaf9;border:1px solid #e1e1de"><i style="width:30%;background:#f0f0ee"></i><i style="flex:1;background:#fff;border:1px solid #e1e1de"></i></div>Light</div>
            </div></div>
        </div>
        <div class="card" id="set-data"><div class="card-head"><h3>${ic('database')} Data & privacy</h3></div>
          ${row('Export everything', 'Markdown + JSON. Your notes are yours', `<button class="btn btn-sm" data-action="toast" data-msg="Export started. You'll get an email with the zip">${ic('download')} Export</button>`)}
          ${row('What the workspace can see', 'Only workspace tasks. Never your personal notes or revisions', '<span class="pill pill-green">Private by default</span>')}
          ${row('Delete account', 'Removes all personal data within 30 days', `<button class="btn btn-sm btn-danger" data-action="toast" data-msg="This is a prototype. Nothing was deleted 🙂">${ic('trash-2')} Delete</button>`)}
        </div>
      </div>
    </div>`;
  }

  /* ===================================================== SHELL ===================================================== */
  const VIEWS = {
    today: { crumbs: () => [['Personal'], ['Today']], render: viewToday },
    review: { crumbs: () => [['Personal'], ['Today', 'today'], ['Review session']], render: viewReview },
    library: { crumbs: a => a ? [['Personal'], ['Library', 'library'], [subj(a).name]] : [['Personal'], ['Library']], render: viewLibrary, after: afterLibrary },
    topic: { crumbs: a => { const t = S.topics.find(x => x.id === a) || S.topics[0]; return [['Library', 'library'], [subj(t.subject).name, 'library/' + t.subject], [t.title]]; }, render: viewTopic },
    inbox: { crumbs: () => [['Personal'], ['Inbox']], render: viewInbox },
    tasks: { crumbs: () => [['Personal'], ['Tasks']], render: viewTasks, after: afterTasks },
    insights: { crumbs: () => [['Personal'], ['Insights']], render: viewInsights },
    overview: { crumbs: () => [['Nimbus Labs'], ['Overview']], render: viewOverview },
    board: { crumbs: () => [['Nimbus Labs'], ['Board']], render: viewBoard, after: afterBoard },
    qa: { crumbs: a => [['Nimbus Labs'], ['QA handoffs', 'qa'], [(S.qa.find(q => q.id === (a || S.qaSel)) || S.qa[0]).title]], render: viewQA },
    agents: { crumbs: () => [['Nimbus Labs'], ['Agents & integrations']], render: viewAgents },
    groups: { crumbs: () => [['Coming later'], ['Study groups']], render: viewGroups },
    settings: { crumbs: () => [['Settings']], render: viewSettings }
  };

  let lastKey = '';
  function current() {
    const h = (location.hash || '#/today').replace(/^#\/?/, '');
    const parts = h.split('/');
    return { name: VIEWS[parts[0]] ? parts[0] : 'today', arg: parts[1] ? decodeURIComponent(parts[1]) : undefined, key: h };
  }
  function render(keep) {
    const { name, arg, key } = current();
    const main = $('#main');
    const st = main.scrollTop;
    const same = keep && key === lastKey;
    main.innerHTML = `<div class="page page-${name} ${same ? 'no-anim' : ''}">${VIEWS[name].render(arg)}</div>`;
    renderSidebar(name);
    renderTopbar(name, arg);
    icons();
    if (VIEWS[name].after) VIEWS[name].after(arg);
    main.scrollTop = same ? st : 0;
    lastKey = key;
  }
  const rerender = () => render(true);

  function renderSidebar(active) {
    const due = S.revisions.filter(r => !r.done && r.due <= 0).length;
    const tasksLeft = S.tasks.filter(t => (t.bucket === 'today' || t.bucket === 'overdue') && !t.done).length;
    const failing = S.qa.filter(q => q.status === 'failing').length;
    const isOn = r => (r === active || (r === 'library' && active === 'topic')) ? 'active' : '';
    const cnt = (n, cls) => n ? `<span class="count ${cls || ''}">${n}</span>` : '';
    const item = (r, i, label, badge) => `<a href="#/${r}" class="nav-item ${isOn(r)}">${ic(i)}<span>${label}</span>${badge || ''}</a>`;
    const light = document.documentElement.dataset.theme === 'light';
    $('#sidebar').innerHTML = `
      <div class="sb-top"><div class="brand"><span class="brand-mark">${ic('brain')}</span>Recollect</div><button class="icon-btn" data-action="theme" title="Toggle theme">${ic(light ? 'moon' : 'sun')}</button></div>
      <button class="sb-search" data-action="palette">${ic('search')}<span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
      <div class="sb-scroll">
        <div class="sb-label">Personal</div>
        ${item('today', 'sun', 'Today', cnt(due + tasksLeft))}
        ${item('review', 'play', 'Review session')}
        ${item('library', 'library', 'Library')}
        ${item('inbox', 'inbox', 'Inbox', cnt(S.captures.length))}
        ${item('tasks', 'list-checks', 'Tasks', cnt(tasksLeft))}
        ${item('insights', 'trending-up', 'Insights')}
        <div class="sb-label">Workspace</div>
        <button class="ws-chip" data-action="ws-switch"><span class="ws-logo">N</span><span><div class="ws-name">Nimbus Labs</div><div class="ws-sub">Core Platform · 5 members</div></span>${ic('chevrons-up-down', 'ic-sm')}</button>
        ${item('overview', 'layout-dashboard', 'Overview')}
        ${item('board', 'kanban', 'Board')}
        ${item('qa', 'flask-conical', 'QA handoffs', cnt(failing, 'red'))}
        ${item('agents', 'bot', 'Agents', '<span class="count violet">MCP</span>')}
        <div class="sb-label">Coming later</div>
        ${item('groups', 'users-round', 'Study groups', '<span class="soon">Preview</span>')}
      </div>
      <div class="sb-bottom">
        ${item('settings', 'settings', 'Settings')}
        <div class="user-row"><span class="av lg" style="--c:#7c7ff7">R</span><div><div class="u-name">${S.user.name}</div><div class="u-mail">${S.user.email}</div></div></div>
      </div>`;
  }

  function renderTopbar(name, arg) {
    const crumbs = VIEWS[name].crumbs(arg);
    const html = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      const inner = last ? `<span class="cur">${c[0]}</span>` : c[1] ? `<a href="#/${c[1]}">${c[0]}</a>` : `<span>${c[0]}</span>`;
      return inner + (last ? '' : ic('chevron-right'));
    }).join('');
    $('#topbar').innerHTML = `
      <button class="icon-btn menu-btn" data-action="menu" aria-label="Menu">${ic('menu')}</button>
      <nav class="crumbs">${html}</nav>
      <div class="tb-right">
        <span class="proto-chip">${ic('flask-conical')} Prototype · dummy data</span>
        <button class="tb-search" data-action="palette">${ic('search')}<span>Search, jump or capture…</span><kbd>Ctrl K</kbd></button>
        <button class="icon-btn" data-action="capture-quick" title="Quick capture (C)">${ic('plus')}</button>
        <button class="icon-btn" data-action="notif" title="Notifications">${ic('bell')}${S.unread ? `<span class="dot-badge">${S.unread}</span>` : ''}</button>
      </div>
      ${S.notifOpen ? `<div class="dropdown">
        <div class="dd-head">Notifications <button class="link" data-action="notif-read">Mark all read</button></div>
        ${S.notifications.map(n => `<div class="notif" data-action="go" data-to="${n.route}"><span class="feed-icon ${n.tone === 'red' ? 'red' : n.tone === 'violet' ? 'violet' : ''}">${ic(n.icon)}</span><div>${n.html}</div><span class="feed-time">${n.time}</span></div>`).join('')}
      </div>` : ''}`;
  }

  /* ---------- overlays ---------- */
  function openOverlay(kind, html) {
    S.overlay = kind;
    $('#overlay-root').innerHTML = `<div class="backdrop" data-action="close-overlay"></div><div class="${kind}" role="dialog" aria-modal="true">${html}</div>`;
    icons();
  }
  function closeOverlay() { S.overlay = null; S.pal = null; $('#overlay-root').innerHTML = ''; }

  const COMMANDS = [
    ['Actions', 'sparkles', 'Capture a thought or learning', 'C', () => openCapture()],
    ['Actions', 'play', 'Start review session', 'R', () => { startReview(); go('review'); }],
    ['Actions', 'circle-plus', 'New task', 'T', () => { go('tasks'); setTimeout(() => { const i = $('#task-in'); if (i) i.focus(); }, 80); }],
    ['Actions', 'download', 'Import a DSA sheet (NeetCode, Striver…)', '', () => { go('library'); setTimeout(openImport, 120); }],
    ['Actions', 'flask-conical', 'Open the failing QA handoff', '', () => go('qa/otp')],
    ['Actions', 'moon', 'Toggle dark / light theme', '', () => toggleTheme()],
    ['Go to', 'sun', 'Today', '', () => go('today')],
    ['Go to', 'library', 'Library', '', () => go('library')],
    ['Go to', 'inbox', 'Inbox', '', () => go('inbox')],
    ['Go to', 'list-checks', 'Tasks', '', () => go('tasks')],
    ['Go to', 'trending-up', 'Insights', '', () => go('insights')],
    ['Go to', 'layout-dashboard', 'Workspace overview', '', () => go('overview')],
    ['Go to', 'kanban', 'Board', '', () => go('board')],
    ['Go to', 'bot', 'Agents & integrations', '', () => go('agents')],
    ['Go to', 'users-round', 'Study groups (preview)', '', () => go('groups')],
    ['Go to', 'settings', 'Settings', '', () => go('settings')],
    ...S.topics.slice(0, 30).map(t => ['Topics', 'file-text', t.title, '', () => go('topic/' + t.id)])
  ];
  function paletteList() {
    const q = (S.pal.q || '').toLowerCase();
    const items = COMMANDS.filter(c => !q || c[2].toLowerCase().includes(q)).slice(0, q ? 12 : 16);
    S.pal.items = items;
    if (S.pal.sel >= items.length) S.pal.sel = 0;
    let g = '';
    return items.map((c, i) => {
      const head = c[0] !== g ? `<div class="pal-group">${(g = c[0])}</div>` : '';
      return head + `<div class="pal-item ${i === S.pal.sel ? 'sel' : ''}" data-action="pal-run" data-i="${i}">${ic(c[1])}<span>${c[2]}</span>${c[3] ? `<kbd>${c[3]}</kbd>` : ''}</div>`;
    }).join('') || `<div class="empty small">No matches. Press Enter to capture "<b>${esc(S.pal.q)}</b>" to your Inbox.</div>`;
  }
  function openPalette() {
    S.pal = { q: '', sel: 0, items: [] };
    openOverlay('palette', `<div class="palette-in">${ic('search')}<input id="pal-in" placeholder="Type a command, a topic, or a thought to capture…" autocomplete="off"></div><div class="palette-list" id="pal-list">${paletteList()}</div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div>`);
    const inp = $('#pal-in'); inp.focus();
    inp.addEventListener('input', () => { S.pal.q = inp.value; S.pal.sel = 0; $('#pal-list').innerHTML = paletteList(); icons(); });
    inp.addEventListener('keydown', e => {
      const n = S.pal.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); S.pal.sel = (S.pal.sel + 1) % Math.max(n, 1); $('#pal-list').innerHTML = paletteList(); icons(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); S.pal.sel = (S.pal.sel - 1 + n) % Math.max(n, 1); $('#pal-list').innerHTML = paletteList(); icons(); }
      if (e.key === 'Enter') { e.preventDefault(); runPal(S.pal.sel); }
    });
  }
  function runPal(i) {
    const c = S.pal && S.pal.items[i];
    const q = S.pal && S.pal.q;
    closeOverlay();
    if (c) c[4]();
    else if (q) { S.captures.unshift({ id: 'k' + Date.now(), type: 'note', title: q, source: 'Captured with Ctrl K', time: 'Just now', subject: 'dsa', preview: 'Quick note: file it into a topic or schedule a revision.' }); toast(`Captured to Inbox: <b>${esc(q)}</b>`, 'inbox', 'ok'); rerender(); }
  }
  function openCapture() {
    openOverlay('modal', `
      <div class="modal-head">${ic('sparkles')}<h3>Quick capture</h3><button class="icon-btn" data-action="close-overlay">${ic('x')}</button></div>
      <div class="modal-body">
        <textarea id="qc-text" class="field" style="min-height:110px" placeholder="A thought, a link, a snippet… or what you just learned."></textarea>
        <div class="cap-row" style="margin-top:10px">
          <select id="qc-subject" class="field">${S.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
          <button class="btn" data-action="qc-save" data-mode="inbox">${ic('inbox')} Save to Inbox</button>
          <button class="btn btn-primary" data-action="qc-save" data-mode="schedule">${ic('repeat')} Save & schedule</button>
        </div>
        <div class="cap-sched">${ic('info', 'ic-sm')} "Save & schedule" adds revisions on ${INTERVALS.map(d => `<b>${fmtD(d, { day: 'numeric', month: 'short' })}</b>`).join(', ')}.</div>
      </div>`);
    setTimeout(() => { const t = $('#qc-text'); if (t) t.focus(); }, 30);
  }
  function openImport() {
    const sheets = [['NeetCode 150', '150 problems in 18 patterns. The most popular interview list'], ['Striver A2Z DSA', '455 problems, from basics to advanced'], ['Blind 75', 'The classic 75 for a short runway'], ['Love Babbar 450', '450 problems across 18 topics'], ['LeetCode list URL', 'Paste any public LeetCode list'], ['CSV / Google Sheet', 'Columns: title, link, topic, date solved']];
    openOverlay('modal', `
      <div class="modal-head">${ic('download')}<h3>Import a sheet</h3><button class="icon-btn" data-action="close-overlay">${ic('x')}</button></div>
      <div class="modal-body"><p class="muted">Problems become topics. Mark the ones you've already solved and Recollect schedules their revisions. The rest wait until you solve them.</p>
        <div class="sheet-grid">${sheets.map(([t, d]) => `<button class="sheet-opt" data-action="import-pick" data-name="${t}"><div class="s-t">${t}</div><div class="s-d">${d}</div></button>`).join('')}</div>
      </div>`);
  }

  function toggleTheme(v) {
    const root = document.documentElement;
    root.dataset.theme = v || (root.dataset.theme === 'light' ? 'dark' : 'light');
    try { localStorage.setItem('rc-theme', root.dataset.theme); } catch (e) { /* ignore */ }
    rerender();
  }

  /* ---------- actions ---------- */
  const A = {
    'go': el => { S.notifOpen = false; go(el.dataset.to); },
    'menu': () => $('#sidebar').classList.toggle('open'),
    'theme': () => toggleTheme(),
    'set-theme': el => toggleTheme(el.dataset.v),
    'palette': () => openPalette(),
    'pal-run': el => runPal(+el.dataset.i),
    'close-overlay': () => closeOverlay(),
    'notif': () => { S.notifOpen = !S.notifOpen; if (S.notifOpen) S.unread = 0; const { name, arg } = current(); renderTopbar(name, arg); icons(); },
    'notif-read': () => { S.unread = 0; S.notifOpen = false; const { name, arg } = current(); renderTopbar(name, arg); icons(); toast('All caught up', 'check-check', 'ok'); },
    'toast': el => toast(el.dataset.msg, 'check', 'ok'),
    'ws-switch': () => toast('Workspaces: <b>Nimbus Labs</b> (current) · Side projects · + New workspace', 'building-2', 'info'),
    'invite': () => toast('Invite link copied. New people join as <b>Member</b>', 'user-plus', 'ok', 'Admins can change roles any time'),
    'start-review': () => startReview(),

    'reveal': el => { const r = S.revisions.find(x => x.id === el.dataset.id); r.revealed = !r.revealed; rerender(); },
    'rate': el => { rate(el.dataset.id, el.dataset.grade); rerender(); },
    'amnesty': () => { amnesty(); rerender(); },
    'today-tab': el => { S.todayTab = el.dataset.tab; rerender(); },
    'capture-save': () => {
      const t = $('#cap-text'); const v = t.value.trim();
      if (!v) { t.focus(); toast('Write what you learned first ✍️', 'pencil', 'warn'); return; }
      const sid = $('#cap-subject').value;
      const title = v.length > 64 ? v.slice(0, 61) + '…' : v;
      S.recentlyLearned.unshift({ title, subject: sid, when: 'Just now' });
      S.topics.unshift({ id: 'new' + Date.now(), title, subject: sid, group: 'New', tags: [], state: 'progress', cycle: 1, next: 1, last: null, edited: 'Today' });
      subj(sid).total++; subj(sid).progress++;
      toast(`Saved to <b>${subj(sid).name}</b>`, 'calendar-check', 'ok', 'Revisions: ' + INTERVALS.map(d => fmtD(d, { day: 'numeric', month: 'short' })).join(', '));
      rerender();
    },
    'task-toggle': el => {
      const t = S.tasks.find(x => x.id === el.dataset.id); t.done = !t.done;
      if (t.done) toast(`Done: <b>${t.title}</b>`, 'circle-check', 'ok', t.ws ? 'The workspace board was updated too' : '');
      rerender();
    },
    'task-filter': el => { S.taskFilter = el.dataset.f; rerender(); },

    'review-reveal': () => { S.review.revealed = true; rerender(); },
    'review-rate': el => { rate(el.dataset.id, el.dataset.grade, true); S.review.results.push({ id: el.dataset.id, g: el.dataset.grade }); S.review.idx++; S.review.revealed = false; rerender(); },
    'review-ahead': () => toast('Pulled 5 revisions forward from tomorrow', 'fast-forward', 'info', 'Tomorrow just got lighter'),

    'lib-filter': el => { S.libFilter = el.dataset.f; rerender(); },
    'open-topic': el => go('topic/' + el.dataset.id),
    'import-sheet': () => openImport(),
    'import-pick': el => { closeOverlay(); toast(`Importing <b>${el.dataset.name}</b> into DSA…`, 'download', 'info', 'Mark the ones you’ve solved and they’ll be scheduled'); },
    'new-topic': el => { const id = 'untitled' + Date.now(); S.topics.unshift({ id, title: 'Untitled topic', subject: el.dataset.subject || 'dsa', group: 'New', tags: [], state: 'new', cycle: 0, next: null, last: null, edited: 'Just now' }); go('topic/' + id); },

    'topic-recall': () => { S.recallMode = !S.recallMode; rerender(); },
    'unblur': el => { if (el.closest('.recall-mode')) el.classList.add('shown'); },
    'topic-mark': () => { S.topicRating = !S.topicRating; rerender(); },
    'topic-rate': el => { rate(el.dataset.id, el.dataset.grade); S.topicRating = false; rerender(); },
    'topic-ai': () => { S.topicAI = !S.topicAI; rerender(); },
    'ai-add': () => { S.topicAI = false; toast('Recall questions added. You’ll get one during each review', 'sparkles', 'agent'); rerender(); },
    'topic-start': el => { const t = S.topics.find(x => x.id === el.dataset.id); t.state = 'progress'; t.cycle = 1; t.next = 1; toast(`Revising <b>${t.title}</b> from tomorrow`, 'calendar-check', 'ok', INTERVALS.map(d => fmtD(d, { day: 'numeric', month: 'short' })).join(' · ')); rerender(); },
    'topic-link-task': () => toast('Pick a task to link (prototype)', 'list-plus', 'info'),
    'share': () => toast('Read-only link copied', 'share-2', 'ok', 'Anyone with the link can view this topic'),
    'copy-code': () => toast('Code copied', 'copy', 'ok'),

    'inbox-tab': el => { S.inboxTab = el.dataset.tab; rerender(); },
    'cap-topic': el => { const c = removeCap(el.dataset.id); S.topics.unshift({ id: 'cap' + Date.now(), title: c.title, subject: c.subject, group: 'From Inbox', tags: [], state: 'progress', cycle: 1, next: 1, last: null, edited: 'Just now' }); toast(`Turned into a topic in <b>${subj(c.subject).name}</b>`, 'file-plus', 'ok', 'First revision tomorrow'); rerender(); },
    'cap-sched': el => { const c = removeCap(el.dataset.id); toast(`Revision scheduled: <b>${c.title}</b>`, 'repeat', 'ok', 'Next: ' + fmtD(1)); rerender(); },
    'cap-task': el => { const c = removeCap(el.dataset.id); S.tasks.splice(1, 0, { id: 'n' + Date.now(), title: c.title, bucket: 'today', due: 'Today', tag: 'learning', pri: 'normal' }); toast(`Added to today's tasks`, 'list-plus', 'ok'); rerender(); },
    'cap-archive': el => { removeCap(el.dataset.id); toast('Archived', 'archive', 'info'); rerender(); },
    'cap-convert': el => {
      toast('Reading your handwriting…', 'scan-text', 'agent', 'Cleaning the photo, then structuring the notes');
      setTimeout(() => { removeCap(el.dataset.id); S.topics.unshift({ id: 'hashing2', title: 'Consistent hashing (from photo)', subject: 'sysdesign', group: 'Distribution', tags: ['from-photo'], state: 'progress', cycle: 1, next: 1, last: null, edited: 'Just now' }); toast('Converted: <b>Consistent hashing</b>', 'sparkles', 'agent', '6 key points and 1 diagram · first revision tomorrow'); rerender(); }, 1500);
    },
    'capture-quick': () => openCapture(),
    'qc-save': el => {
      const v = ($('#qc-text').value || '').trim();
      if (!v) { toast('Type something first', 'pencil', 'warn'); return; }
      const sid = $('#qc-subject').value;
      if (el.dataset.mode === 'inbox') { S.captures.unshift({ id: 'k' + Date.now(), type: 'note', title: v.slice(0, 70), source: 'Quick capture', time: 'Just now', subject: sid, preview: v }); toast('Saved to Inbox', 'inbox', 'ok'); }
      else { S.recentlyLearned.unshift({ title: v.slice(0, 64), subject: sid, when: 'Just now' }); toast(`Saved and scheduled in <b>${subj(sid).name}</b>`, 'calendar-check', 'ok', INTERVALS.map(d => fmtD(d, { day: 'numeric', month: 'short' })).join(' · ')); }
      closeOverlay(); rerender();
    },

    'board-filter': el => { S.boardFilter = el.dataset.f; rerender(); },
    'card-open': el => openCard(el.dataset.id),
    'new-card': () => { S.cards.unshift({ id: 'c' + Date.now(), col: 'backlog', title: 'New task', labels: ['new'], pri: 'medium', who: 'ramin' }); toast('Task created in Backlog', 'plus', 'ok', 'Tip: Claude Code can create these from your terminal'); rerender(); },

    'qa-step': el => {
      const q = S.qa.find(x => x.id === S.qaSel); const s = q.steps[+el.dataset.i];
      s.result = s.result === el.dataset.r ? null : el.dataset.r;
      if (s.result === 'fail' && !s.note) s.note = 'Marked failed during re-test.';
      recomputeQA(q);
      if (q.status === 'passed') toast(`All ${q.steps.length} steps pass`, 'circle-check', 'ok', 'Mark it verified to move the card to Done');
      rerender();
    },
    'qa-verify': () => {
      const q = S.qa.find(x => x.id === S.qaSel); q.status = 'verified';
      const card = S.cards.find(c => c.qa === q.id); if (card) card.col = 'done';
      const fix = S.cards.find(c => c.id === 'c4'); if (q.id === 'otp' && fix) fix.col = 'done';
      q.thread.push({ who: 'priya', time: 'now', html: 'Re-tested. All steps pass. Verified ✅' });
      toast(`<b>${q.title}</b> verified`, 'badge-check', 'ok', 'Card moved to Done. Claude Code told Ramin in the terminal.');
      rerender();
    },
    'qa-sendback': () => {
      const q = S.qa.find(x => x.id === S.qaSel);
      q.thread.push({ who: 'priya', time: 'now', html: 'Sending back. See the failed steps.' });
      toast('Sent back to the developer', 'undo-2', 'agent', 'Claude Code picks it up next time Ramin opens the branch');
      rerender();
    },
    'qa-send': () => {
      const inp = $('#qa-msg'); const v = inp.value.trim(); if (!v) return;
      const q = S.qa.find(x => x.id === S.qaSel);
      q.thread.push({ who: 'ramin', time: 'now', html: esc(v) });
      rerender();
      if (/@claude/i.test(v)) setTimeout(() => {
        q.thread.push({ who: 'claude', time: 'now', html: 'On it. I’ll pick this up next time Ramin opens <code>' + q.branch + '</code> and reply here with the commit.' });
        toast('Claude Code replied', 'bot', 'agent'); rerender();
      }, 1300);
    },

    'perm': el => { S.perms[el.dataset.k] = !S.perms[el.dataset.k]; toast(`${S.perms[el.dataset.k] ? 'Allowed' : 'Blocked'}: ${el.getAttribute('aria-label')}`, 'shield-check', 'info'); rerender(); },
    'copy-cmd': () => { const txt = $('#mcp-cmd').textContent; try { navigator.clipboard.writeText(txt); } catch (e) { /* file:// */ } toast('Command copied', 'copy', 'ok', 'Paste it in your terminal'); },
    'connect': el => toast(`Connecting <b>${el.dataset.name}</b>…`, 'plug', 'info', 'In the real app this opens OAuth or shows the MCP command'),
    'focus-session': () => { toast('Focus session created: 5 topics you keep forgetting', 'target', 'ok'); setTimeout(() => go('review'), 400); },

    'setting': el => { const k = el.dataset.k; S.settings.toggles[k] = !S.settings.toggles[k]; rerender(); },
    'scroll-to': el => { const t = document.getElementById(el.dataset.target); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('.settings-nav .nav-item').forEach(n => n.classList.toggle('active', n === el)); }
  };
  function removeCap(id) { const i = S.captures.findIndex(c => c.id === id); return S.captures.splice(i, 1)[0]; }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (S.notifOpen && !e.target.closest('.dropdown') && !(el && el.dataset.action === 'notif')) {
      S.notifOpen = false; const { name, arg } = current(); renderTopbar(name, arg); icons();
    }
    if (!el) return;
    const fn = A[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' && el.dataset.action === 'start-review') { fn(el, e); return; }
    e.preventDefault();
    fn(el, e);
  });

  document.addEventListener('keydown', e => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); S.overlay === 'palette' ? closeOverlay() : openPalette(); return; }
    if (e.key === 'Escape') { if (S.overlay) closeOverlay(); if (S.notifOpen) { S.notifOpen = false; rerender(); } return; }
    if (S.overlay || typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const { name } = current();
    if (name === 'review' && S.review && S.review.idx < S.review.queue.length) {
      if (e.key === ' ') { e.preventDefault(); if (!S.review.revealed) { S.review.revealed = true; rerender(); } return; }
      const g = { 1: 'cold', 2: 'hint', 3: 'couldnt' }[e.key];
      if (g && S.review.revealed) { const btn = document.querySelector(`[data-action="review-rate"][data-grade="${g}"]`); if (btn) btn.click(); return; }
    }
    if (e.key === 'r' || e.key === 'R') { startReview(); go('review'); }
    else if (e.key === 'c' || e.key === 'C') openCapture();
    else if (e.key === 't' || e.key === 'T') { go('tasks'); setTimeout(() => { const i = $('#task-in'); if (i) i.focus(); }, 80); }
  });

  window.addEventListener('hashchange', () => { $('#sidebar').classList.remove('open'); S.recallMode = false; S.topicAI = false; S.topicRating = false; S.notifOpen = false; render(false); });

  /* ---------- boot ---------- */
  try { const saved = localStorage.getItem('rc-theme'); if (saved) document.documentElement.dataset.theme = saved; } catch (e) { /* ignore */ }
  render(false);
})();
