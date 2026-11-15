/* Recollect prototype — dummy data (all fictional). "Today" is fixed to Tue 20 Oct 2026. */
window.RC_DATA = {
  user: { name: 'Ramin', email: 'ramin@example.com', streak: 12, bestStreak: 34, tz: 'Asia/Kolkata (IST)' },

  subjects: [
    { id: 'dsa', name: 'DSA', icon: 'binary', color: '#f5a524', total: 64, mastered: 21, progress: 30, fresh: 13, desc: 'Patterns, problems and the mistakes I keep making.' },
    { id: 'backend', name: 'Backend', icon: 'server', color: '#7c7ff7', total: 28, mastered: 6, progress: 14, fresh: 8, desc: 'Auth, databases, queues, Node internals.' },
    { id: 'frontend', name: 'Frontend', icon: 'layout-template', color: '#4cc3f5', total: 19, mastered: 5, progress: 9, fresh: 5, desc: 'React, Next.js, CSS and browser behaviour.' },
    { id: 'sysdesign', name: 'System Design', icon: 'network', color: '#b79cfb', total: 11, mastered: 1, progress: 4, fresh: 6, desc: 'Classic designs and trade-offs for interviews.' },
    { id: 'devops', name: 'DevOps & Cloud', icon: 'cloud', color: '#22c38e', total: 8, mastered: 0, progress: 3, fresh: 5, desc: 'Docker, CI/CD, Kubernetes basics.' }
  ],

  /* Items due today or overdue. due = day offset from today (negative = overdue). */
  revisions: [
    {
      id: 'median', title: 'Median of Two Sorted Arrays', subject: 'dsa', topic: 'Binary Search', ref: 'LeetCode #4 · Hard',
      cycle: 3, due: 0, history: ['cold', 'hint'], tags: ['binary-search', 'hard'],
      points: [
        'Binary-search the partition of the <b>smaller</b> array: <code>i</code>; then <code>j = (m + n + 1) / 2 − i</code>.',
        'A partition is valid when <code>maxLeftA ≤ minRightB</code> and <code>maxLeftB ≤ minRightA</code>.',
        'Odd total → <code>max(left)</code>. Even total → average of <code>max(left)</code> and <code>min(right)</code>.',
        'Use ±∞ sentinels when a side is empty. O(log(min(m, n))).'
      ],
      code: { lang: 'java', src: [
        'double findMedian(int[] a, int[] b) {',
        '  if (a.length > b.length) return findMedian(b, a);',
        '  int m = a.length, n = b.length, lo = 0, hi = m;',
        '  while (lo <= hi) {',
        '    int i = (lo + hi) / 2, j = (m + n + 1) / 2 - i;',
        '    int aL = i == 0 ? Integer.MIN_VALUE : a[i - 1];',
        '    int aR = i == m ? Integer.MAX_VALUE : a[i];',
        '    int bL = j == 0 ? Integer.MIN_VALUE : b[j - 1];',
        '    int bR = j == n ? Integer.MAX_VALUE : b[j];',
        '    if (aL <= bR && bL <= aR) {',
        '      if ((m + n) % 2 == 1) return Math.max(aL, bL);',
        '      return (Math.max(aL, bL) + Math.min(aR, bR)) / 2.0;',
        '    } else if (aL > bR) hi = i - 1; else lo = i + 1;',
        '  }',
        '  return 0; // unreachable for valid input',
        '}'
      ].join('\n') },
      questions: [
        'Why do we binary-search on the smaller array?',
        'What are the two conditions that make a partition valid?',
        'How is the median computed when m + n is even?'
      ]
    },
    {
      id: 'lru', title: 'LRU Cache', subject: 'dsa', topic: 'Design', ref: 'LeetCode #146 · Medium',
      cycle: 2, due: -2, history: ['cold'], tags: ['hashmap', 'linked-list'],
      points: [
        '<code>HashMap&lt;key, Node&gt;</code> + a <b>doubly linked list</b> ordered by recency.',
        '<code>get</code>: look up, move the node to the head, return the value.',
        '<code>put</code>: insert or update at the head; if over capacity, evict <code>tail.prev</code>.',
        'Dummy head and tail nodes remove every null check. Both operations O(1).'
      ],
      code: { lang: 'java', src: [
        'public int get(int key) {',
        '  Node node = map.get(key);',
        '  if (node == null) return -1;',
        '  remove(node); addToHead(node);',
        '  return node.val;',
        '}'
      ].join('\n') }
    },
    {
      id: 'jwt', title: 'JWT refresh-token rotation', subject: 'backend', topic: 'Auth', ref: 'Learned at work · OTP project',
      cycle: 1, due: 0, history: [], tags: ['auth', 'security'],
      points: [
        'Access token lives ~15 min, in memory only. Refresh token sits in an <b>httpOnly</b> cookie.',
        'Every refresh <b>rotates</b> the refresh token: issue a new one, revoke the old one.',
        'Tokens share a <b>family id</b>. If an old token is reused, revoke the whole family (theft detection).',
        'Store only a hash of the refresh token, never the raw value.'
      ],
      code: { lang: 'ts', src: [
        'const stored = await db.refresh.findByHash(hash(token));',
        'if (!stored || stored.revoked) {',
        '  await revokeFamily(stored?.familyId); // reuse = theft',
        '  throw new Unauthorized();',
        '}',
        'await db.refresh.revoke(stored.id);',
        'return issueTokenPair(user, stored.familyId);'
      ].join('\n') }
    },
    {
      id: 'useeffect', title: 'useEffect cleanup & race conditions', subject: 'frontend', topic: 'React', ref: 'react.dev · Synchronizing with Effects',
      cycle: 2, due: 0, history: ['hint'], tags: ['react', 'hooks'],
      points: [
        'Return a cleanup function. It runs before the next effect and on unmount.',
        'Abort in-flight requests with <code>AbortController</code> so stale responses never call <code>setState</code>.',
        'Ignore <code>AbortError</code>; surface every other error.',
        'If the dependency array lies, the bug is the effect, not React.'
      ],
      code: { lang: 'js', src: [
        'useEffect(() => {',
        '  const ctrl = new AbortController();',
        "  fetch('/api/users/' + id, { signal: ctrl.signal })",
        '    .then(r => r.json())',
        '    .then(setUser)',
        "    .catch(e => { if (e.name !== 'AbortError') setError(e); });",
        '  return () => ctrl.abort();',
        '}, [id]);'
      ].join('\n') }
    },
    {
      id: 'kafka', title: 'Kafka consumer groups & rebalancing', subject: 'backend', topic: 'Messaging', ref: 'Confluent docs',
      cycle: 1, due: -1, history: [], tags: ['kafka', 'distributed'],
      points: [
        'Within a group, each partition is consumed by <b>one</b> consumer at a time. Consumers beyond the partition count sit idle.',
        'Joining, leaving or crashing triggers a <b>rebalance</b>. The cooperative-sticky assignor avoids stop-the-world pauses.',
        'Commit offsets <b>after</b> processing for at-least-once delivery. Make handlers idempotent.',
        'Watch consumer lag: if it keeps growing, the consumers can’t keep up.'
      ]
    },
    {
      id: 'slidingmax', title: 'Sliding Window Maximum', subject: 'dsa', topic: 'Sliding Window', ref: 'LeetCode #239 · Hard',
      cycle: 4, due: 0, history: ['hint', 'cold', 'cold'], tags: ['deque', 'monotonic'],
      points: [
        'Keep a deque of <b>indices</b> whose values are decreasing.',
        'Pop the back while it’s smaller than the new value; it can never be a maximum again.',
        'Pop the front when it falls out of the window. The front is always the maximum.',
        'Every index is pushed and popped at most once, so the whole pass is O(n).'
      ],
      code: { lang: 'java', src: [
        'Deque<Integer> dq = new ArrayDeque<>();',
        'for (int i = 0; i < n; i++) {',
        '  while (!dq.isEmpty() && dq.peekFirst() <= i - k) dq.pollFirst();',
        '  while (!dq.isEmpty() && nums[dq.peekLast()] < nums[i]) dq.pollLast();',
        '  dq.offerLast(i);',
        '  if (i >= k - 1) res[i - k + 1] = nums[dq.peekFirst()];',
        '}'
      ].join('\n') }
    },
    {
      id: 'indexing', title: 'Database indexes: B-tree vs Hash', subject: 'backend', topic: 'Databases', ref: 'Use The Index, Luke',
      cycle: 2, due: -3, history: ['couldnt'], tags: ['postgres', 'performance'],
      points: [
        'A B-tree handles equality, ranges and <code>ORDER BY</code>. A hash index handles equality only.',
        'Composite indexes follow the <b>leftmost-prefix</b> rule: <code>(user_id, created_at)</code> helps a query on <code>user_id</code> alone, but not one on <code>created_at</code> alone.',
        'Check with <code>EXPLAIN ANALYZE</code>: an Index Scan is good; a Seq Scan on a big table is a warning.',
        'Every index slows down writes. Index for your real queries only.'
      ],
      code: { lang: 'sql', src: [
        'CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);',
        '',
        'EXPLAIN ANALYZE',
        'SELECT * FROM orders WHERE user_id = 42',
        'ORDER BY created_at DESC LIMIT 20;'
      ].join('\n') }
    },
    {
      id: 'stacking', title: 'CSS stacking contexts & z-index', subject: 'frontend', topic: 'CSS', ref: 'MDN',
      cycle: 3, due: 0, history: ['couldnt', 'hint'], tags: ['css'],
      points: [
        'A new stacking context is created by <code>position</code> + <code>z-index</code>, <code>opacity &lt; 1</code>, <code>transform</code>, <code>filter</code> or <code>isolation: isolate</code>.',
        '<code>z-index</code> only competes with siblings in the <b>same</b> context.',
        'A modal trapped inside a transformed parent can never escape it. Portal it to <code>body</code>.',
        'Debug with the DevTools Layers panel instead of raising z-index to 9999.'
      ]
    }
  ],

  /* Library rows. state: new | progress | mastered. next = day offset of the next revision. */
  topics: [
    { id: 'median', title: 'Median of Two Sorted Arrays', subject: 'dsa', group: 'Binary Search', tags: ['hard'], state: 'progress', cycle: 3, next: 0, last: 'hint', edited: 'Oct 13' },
    { id: 'slidingmax', title: 'Sliding Window Maximum', subject: 'dsa', group: 'Sliding Window', tags: ['hard'], state: 'progress', cycle: 4, next: 0, last: 'cold', edited: 'Sep 29' },
    { id: 'lru', title: 'LRU Cache', subject: 'dsa', group: 'Design', tags: ['medium'], state: 'progress', cycle: 2, next: -2, last: 'cold', edited: 'Oct 14' },
    { id: 'dijkstra', title: 'Dijkstra with a min-heap', subject: 'dsa', group: 'Graphs', tags: ['medium'], state: 'progress', cycle: 2, next: 1, last: 'couldnt', edited: 'Oct 15' },
    { id: 'trie', title: 'Trie: insert, search, delete', subject: 'dsa', group: 'Trees', tags: ['medium'], state: 'progress', cycle: 1, next: 2, last: null, edited: 'Oct 18' },
    { id: 'courses', title: 'Course Schedule (topological sort)', subject: 'dsa', group: 'Graphs', tags: ['medium'], state: 'progress', cycle: 3, next: 4, last: 'cold', edited: 'Oct 2' },
    { id: 'coinchange', title: 'Coin Change II', subject: 'dsa', group: 'Dynamic Programming', tags: ['medium'], state: 'mastered', cycle: 4, next: 30, last: 'cold', edited: 'Aug 30' },
    { id: 'kthlargest', title: 'Kth Largest Element in an Array', subject: 'dsa', group: 'Heap', tags: ['medium'], state: 'mastered', cycle: 4, next: 24, last: 'cold', edited: 'Aug 21' },
    { id: 'intervals', title: 'Merge Intervals', subject: 'dsa', group: 'Arrays', tags: ['medium'], state: 'mastered', cycle: 4, next: 18, last: 'cold', edited: 'Aug 12' },
    { id: 'robber2', title: 'House Robber II', subject: 'dsa', group: 'Dynamic Programming', tags: ['medium'], state: 'new', cycle: 0, next: null, last: null, edited: 'Oct 19' },
    { id: 'bits', title: 'Bit manipulation tricks', subject: 'dsa', group: 'Math', tags: ['easy'], state: 'progress', cycle: 1, next: 3, last: 'couldnt', edited: 'Oct 16' },

    { id: 'jwt', title: 'JWT refresh-token rotation', subject: 'backend', group: 'Auth', tags: ['security'], state: 'progress', cycle: 1, next: 0, last: null, edited: 'Oct 19' },
    { id: 'kafka', title: 'Kafka consumer groups & rebalancing', subject: 'backend', group: 'Messaging', tags: ['kafka'], state: 'progress', cycle: 1, next: -1, last: null, edited: 'Oct 18' },
    { id: 'indexing', title: 'Database indexes: B-tree vs Hash', subject: 'backend', group: 'Databases', tags: ['postgres'], state: 'progress', cycle: 2, next: -3, last: 'couldnt', edited: 'Oct 12' },
    { id: 'webhooks', title: 'Idempotent payment webhooks', subject: 'backend', group: 'Payments', tags: ['work'], state: 'progress', cycle: 2, next: 3, last: 'cold', edited: 'Oct 15' },
    { id: 'eventloop', title: 'Node.js event-loop phases', subject: 'backend', group: 'Node.js', tags: ['node'], state: 'progress', cycle: 3, next: 5, last: 'hint', edited: 'Oct 1' },
    { id: 'redis', title: 'Redis caching patterns', subject: 'backend', group: 'Caching', tags: ['redis'], state: 'mastered', cycle: 4, next: 21, last: 'cold', edited: 'Aug 8' },
    { id: 'isolation', title: 'PostgreSQL isolation levels', subject: 'backend', group: 'Databases', tags: ['postgres'], state: 'new', cycle: 0, next: null, last: null, edited: 'Oct 17' },

    { id: 'useeffect', title: 'useEffect cleanup & race conditions', subject: 'frontend', group: 'React', tags: ['hooks'], state: 'progress', cycle: 2, next: 0, last: 'hint', edited: 'Oct 15' },
    { id: 'stacking', title: 'CSS stacking contexts & z-index', subject: 'frontend', group: 'CSS', tags: ['css'], state: 'progress', cycle: 3, next: 0, last: 'hint', edited: 'Oct 9' },
    { id: 'keys', title: 'React reconciliation & keys', subject: 'frontend', group: 'React', tags: ['react'], state: 'progress', cycle: 1, next: 1, last: 'couldnt', edited: 'Oct 18' },
    { id: 'serveractions', title: 'Next.js server actions', subject: 'frontend', group: 'Next.js', tags: ['next'], state: 'progress', cycle: 2, next: 6, last: 'cold', edited: 'Oct 11' },
    { id: 'vitals', title: 'Core Web Vitals: LCP & INP', subject: 'frontend', group: 'Performance', tags: ['perf'], state: 'mastered', cycle: 4, next: 26, last: 'cold', edited: 'Jul 30' },

    { id: 'hashing', title: 'Consistent hashing', subject: 'sysdesign', group: 'Distribution', tags: ['classic'], state: 'progress', cycle: 1, next: 2, last: null, edited: 'Oct 19' },
    { id: 'ratelimiter', title: 'Design a rate limiter', subject: 'sysdesign', group: 'Classic designs', tags: ['interview'], state: 'new', cycle: 0, next: null, last: null, edited: 'Oct 10' },
    { id: 'shortener', title: 'Design a URL shortener', subject: 'sysdesign', group: 'Classic designs', tags: ['interview'], state: 'mastered', cycle: 4, next: 15, last: 'cold', edited: 'Aug 2' },

    { id: 'docker', title: 'Docker multi-stage builds', subject: 'devops', group: 'Docker', tags: ['docker'], state: 'progress', cycle: 2, next: 4, last: 'hint', edited: 'Oct 8' },
    { id: 'probes', title: 'Kubernetes liveness vs readiness probes', subject: 'devops', group: 'Kubernetes', tags: ['k8s'], state: 'new', cycle: 0, next: null, last: null, edited: 'Oct 14' }
  ],

  recentlyLearned: [
    { title: 'JWT refresh-token rotation', subject: 'backend', when: 'Yesterday' },
    { title: 'Trie: insert, search, delete', subject: 'dsa', when: '2 days ago' },
    { title: 'Kafka consumer groups & rebalancing', subject: 'backend', when: '2 days ago' },
    { title: 'React reconciliation & keys', subject: 'frontend', when: '2 days ago' }
  ],

  forecast: [8, 5, 3, 6, 4, 9, 2],

  tasks: [
    { id: 't7', title: 'Renew domain re-collect.in', bucket: 'overdue', due: 'Yesterday', tag: 'personal', pri: 'normal' },
    { id: 't1', title: 'Fix OTP resend timer', bucket: 'today', due: 'Today · 6:00 PM', tag: 'work', pri: 'high', ws: 'Nimbus Labs', agent: true, note: 'From QA handoff · step 4 failed' },
    { id: 't2', title: 'Solve 2 new DP problems', bucket: 'today', due: 'Today', tag: 'dsa', pri: 'normal', note: 'House Robber II · Coin Change II', topic: 'robber2' },
    { id: 't3', title: 'Read DDIA ch. 5: Replication', bucket: 'today', due: 'Today · 9:30 PM', tag: 'learning', pri: 'normal' },
    { id: 't4', title: 'Review PR #151: webhook retries', bucket: 'upcoming', due: 'Tomorrow · 11:00 AM', tag: 'work', pri: 'high', ws: 'Nimbus Labs' },
    { id: 't5', title: 'Mock interview with Arjun', bucket: 'upcoming', due: 'Sun · 7:00 PM', tag: 'career', pri: 'high' },
    { id: 't6', title: 'Add the OTP project to my resume', bucket: 'upcoming', due: 'Sat', tag: 'career', pri: 'normal' },
    { id: 't8', title: 'Try Rust ownership basics', bucket: 'someday', due: '', tag: 'learning', pri: 'low' },
    { id: 't9', title: 'Blog post: CRDTs in practice', bucket: 'someday', due: '', tag: 'career', pri: 'low' }
  ],

  captures: [
    { id: 'k1', type: 'agent', title: 'Why sync crypto calls block Node’s event loop', source: 'Saved by Claude Code · session “fix login perf”', time: '47 min ago', subject: 'backend',
      preview: '<code>bcrypt.hashSync</code> runs on the main thread, so every login request waits behind it. Use the async API (libuv thread pool) or a worker. That cut p95 login from 900 ms to 140 ms.' },
    { id: 'k2', type: 'link', title: 'Use The Index, Luke: reading execution plans', source: 'Shared from phone', url: 'use-the-index-luke.com', time: '2 h ago', subject: 'backend',
      preview: 'How to read EXPLAIN output, and why column order inside a composite index matters.' },
    { id: 'k4', type: 'photo', title: 'Whiteboard: consistent hashing', source: 'Photo upload · 1 page', time: 'Yesterday', subject: 'sysdesign',
      preview: 'Handwritten notes: hash ring, virtual nodes, what moves when a node leaves.' },
    { id: 'k3', type: 'snippet', title: 'git rebase -i --autosquash', source: 'Captured with Ctrl K', time: 'Yesterday', subject: 'devops',
      preview: 'Mark fixups with <code>git commit --fixup &lt;sha&gt;</code>, then <code>git rebase -i --autosquash main</code> folds them in.' },
    { id: 'k5', type: 'note', title: 'Interview habit: say the brute force first', source: 'Quick note', time: '2 days ago', subject: 'dsa',
      preview: 'State the brute force and its complexity, then optimise out loud. Interviewers are grading the path, not just the answer.' },
    { id: 'k6', type: 'link', title: 'NeetCode: Dynamic Programming playlist', source: 'Shared from phone', url: 'youtube.com', time: '3 days ago', subject: 'dsa',
      preview: '1-D and 2-D DP patterns across 20 videos. Pair it with the House Robber series.' }
  ],

  /* ---------------- Workspace ---------------- */
  workspace: { name: 'Nimbus Labs', space: 'Core Platform', sprint: 'Sprint 14', goal: 'Ship OTP login to beta by Friday', ends: 'Fri, 23 Oct', progress: 64 },

  members: {
    ramin: { name: 'Ramin', role: 'Developer (you)', color: '#7c7ff7', initials: 'R' },
    priya: { name: 'Priya Sharma', role: 'QA Analyst', color: '#f472b6', initials: 'PS' },
    arjun: { name: 'Arjun Mehta', role: 'Backend Developer', color: '#22c38e', initials: 'AM' },
    vikram: { name: 'Vikram Rao', role: 'Frontend Developer', color: '#4cc3f5', initials: 'VR' },
    neha: { name: 'Neha Kapoor', role: 'Engineering Lead', color: '#f5a524', initials: 'NK' },
    claude: { name: 'Claude Code', role: 'AI agent · acts for Ramin', color: '#b79cfb', agent: true },
    github: { name: 'GitHub', role: 'Integration', color: '#8b8d90', bot: true }
  },

  activity: [
    { who: 'claude', icon: 'git-commit-horizontal', html: 'pushed <code>2a91f0e</code> “fix: 30s resend cooldown, invalidate old OTP” and asked <b>Priya</b> to re-test step 4', time: '4m', link: 'qa' },
    { who: 'claude', icon: 'bug', html: 'created the fix task <b>Fix OTP resend timer</b> from the failed step and assigned it to <b>Ramin</b>', time: '16m', link: 'board' },
    { who: 'priya', icon: 'circle-x', tone: 'red', html: 'failed step 4, <b>Resend OTP after 30s</b>: “resend unlocks at 60s and the old code still works”', time: '18m', link: 'qa' },
    { who: 'claude', icon: 'flask-conical', html: 'created the QA handoff <b>OTP login flow</b> from <code>feat/otp-login</code> with 4 test steps', time: '42m', link: 'qa' },
    { who: 'arjun', icon: 'git-pull-request', html: 'moved <b>Payment webhook retries</b> to In review and requested your review', time: '1h', link: 'board' },
    { who: 'neha', icon: 'target', html: 'set the sprint goal: <b>Ship OTP login to beta by Friday</b>', time: '3h' },
    { who: 'vikram', icon: 'circle-check', tone: 'green', html: 'completed <b>Compress avatars on upload</b>', time: '5h', link: 'board' }
  ],

  teamToday: [
    { who: 'ramin', focus: 'Fix OTP resend timer', state: 'Fix pushed by Claude Code · re-test pending', tone: 'violet' },
    { who: 'priya', focus: 'Testing OTP login flow', state: '3 of 4 steps passed', tone: 'amber' },
    { who: 'arjun', focus: 'Payment webhook retries', state: 'In review · waiting on Ramin', tone: 'indigo' },
    { who: 'vikram', focus: 'Settings page redesign', state: '3 of 7 subtasks done', tone: 'sky' },
    { who: 'neha', focus: 'Sprint 14 planning', state: 'Beta checklist 6 of 9', tone: 'green' }
  ],

  columns: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'progress', name: 'In progress' },
    { id: 'review', name: 'In review' },
    { id: 'qa', name: 'QA testing' },
    { id: 'done', name: 'Done' }
  ],

  cards: [
    { id: 'c1', col: 'backlog', title: 'Rate-limit the OTP request endpoint', labels: ['security'], pri: 'medium', who: 'arjun' },
    { id: 'c2', col: 'backlog', title: 'Export the audit log as CSV', labels: ['admin'], pri: 'low', who: null },
    { id: 'c3', col: 'backlog', title: 'Dark mode for transactional emails', labels: ['design'], pri: 'low', who: 'vikram' },
    { id: 'c4', col: 'progress', title: 'Fix OTP resend timer', labels: ['bug', 'auth'], pri: 'high', who: 'ramin', agent: true, pr: '#142', desc: 'Created by Claude Code from QA failure on step 4 of “OTP login flow”. Root cause: <code>RESEND_COOLDOWN = 60</code> and the old OTP wasn’t invalidated on resend.' },
    { id: 'c5', col: 'progress', title: 'Settings page redesign', labels: ['frontend'], pri: 'medium', who: 'vikram', sub: '3/7' },
    { id: 'c6', col: 'progress', title: 'Alert on Kafka consumer lag', labels: ['infra'], pri: 'medium', who: 'arjun' },
    { id: 'c7', col: 'review', title: 'Payment webhook retries with backoff', labels: ['payments'], pri: 'high', who: 'arjun', pr: '#151', desc: 'Exponential backoff (1s → 5 min, 8 attempts) plus a dead-letter queue. Waiting on Ramin’s review.' },
    { id: 'c8', col: 'review', title: 'Refactor auth middleware', labels: ['auth', 'tech-debt'], pri: 'medium', who: 'ramin', pr: '#148', agent: true },
    { id: 'c9', col: 'qa', title: 'OTP login flow', labels: ['auth'], pri: 'high', who: 'priya', qa: 'otp', agent: true, qaDone: 3, qaTotal: 4 },
    { id: 'c10', col: 'qa', title: 'Profile avatar upload', labels: ['frontend'], pri: 'medium', who: 'priya', qa: 'avatar', qaDone: 5, qaTotal: 5 },
    { id: 'c11', col: 'done', title: 'Compress avatars on upload', labels: ['frontend'], pri: 'low', who: 'vikram' },
    { id: 'c12', col: 'done', title: 'Fix invoice PDF fonts', labels: ['payments'], pri: 'medium', who: 'arjun' },
    { id: 'c13', col: 'done', title: 'Session timeout banner', labels: ['auth'], pri: 'low', who: 'ramin', agent: true }
  ],

  qa: [
    {
      id: 'otp', title: 'OTP login flow', status: 'failing', owner: 'ramin', tester: 'priya', via: 'claude', created: '42 min ago',
      branch: 'feat/otp-login', pr: '#142', commit: '8f3a2c1', env: 'staging.nimbus.dev', build: '2026.10.20-3',
      summary: [
        'New endpoints <code>POST /auth/otp/request</code> and <code>POST /auth/otp/verify</code>.',
        'OTPs are stored <b>hashed</b> with a 5-minute TTL. 3 wrong attempts → 15-minute lockout.',
        'A resend cooldown was added (<code>config/limits.ts</code>), plus a new <code>&lt;OtpInput /&gt;</code> component with paste support.'
      ],
      files: [
        { path: 'backend/src/auth/otp.controller.ts', add: 142, del: 0 },
        { path: 'backend/src/auth/otp.service.ts', add: 88, del: 0 },
        { path: 'backend/src/config/limits.ts', add: 3, del: 1 },
        { path: 'frontend/components/auth/OtpInput.tsx', add: 64, del: 0 }
      ],
      steps: [
        { text: 'Request an OTP with a valid phone number', expected: 'The SMS arrives within 10 seconds; the UI shows a 30s resend timer', result: 'pass' },
        { text: 'Enter a wrong OTP 3 times', expected: 'The account locks for 15 minutes with a clear message', result: 'pass' },
        { text: 'Enter the correct OTP', expected: 'Redirect to the dashboard; the session cookie is set (httpOnly)', result: 'pass' },
        { text: 'Tap “Resend OTP” after 30 seconds', expected: 'Resend unlocks at 30s and the previous code stops working', result: 'fail', note: 'Resend unlocks at 60s, and the old code is still accepted.' }
      ],
      thread: [
        { who: 'claude', time: '42m', html: 'Handoff created from <code>feat/otp-login</code> (PR #142). I wrote 4 test steps from the diff. Step 4 covers the new resend cooldown.' },
        { who: 'priya', time: '18m', html: 'Step 4 fails: resend unlocks at <b>60s</b>, and the previous OTP is still accepted after a resend.' },
        { who: 'claude', time: '4m', html: 'Root cause: <code>RESEND_COOLDOWN</code> was 60 in <code>limits.ts</code>, and resend didn’t invalidate the old hash. Fix pushed in <code>2a91f0e</code>. @Priya, ready to re-test step 4.' }
      ]
    },
    {
      id: 'webhook', title: 'Payment webhook retries', status: 'ready', owner: 'arjun', tester: 'priya', via: 'arjun', created: '1 h ago',
      branch: 'feat/webhook-retries', pr: '#151', commit: 'c41d9e0', env: 'staging.nimbus.dev', build: '2026.10.20-2',
      summary: [
        'Failed webhooks retry with exponential backoff: 1s, 5s, 30s … up to 5 minutes, 8 attempts.',
        'After the final attempt the event lands in a dead-letter queue, with an alert.',
        'An idempotency key stops duplicate payment updates.'
      ],
      files: [
        { path: 'backend/src/payments/webhook.worker.ts', add: 97, del: 12 },
        { path: 'backend/src/payments/dlq.ts', add: 41, del: 0 }
      ],
      steps: [
        { text: 'Simulate a provider 500 on the first delivery', expected: 'Retried after ~1s, then succeeds', result: null },
        { text: 'Make every attempt fail', expected: '8 attempts, then the event is in the DLQ and the alert fires', result: null },
        { text: 'Deliver the same event twice', expected: 'The payment is updated only once', result: null },
        { text: 'Check the admin log', expected: 'Every attempt is visible with status and latency', result: null },
        { text: 'Replay from the DLQ', expected: 'The event processes and leaves the DLQ', result: null }
      ],
      thread: [{ who: 'arjun', time: '1h', html: 'Ready for QA. The staging provider mock is in <code>/admin/mocks</code>.' }]
    },
    {
      id: 'avatar', title: 'Profile avatar upload', status: 'passed', owner: 'vikram', tester: 'priya', via: 'vikram', created: 'Yesterday',
      branch: 'feat/avatar-upload', pr: '#139', commit: '77ab210', env: 'staging.nimbus.dev', build: '2026.10.19-4',
      summary: ['Crop, compress (WebP, ≤ 200 KB) and upload the avatar; the old one is cleaned up from storage.'],
      files: [{ path: 'frontend/components/profile/AvatarUpload.tsx', add: 120, del: 18 }],
      steps: [
        { text: 'Upload a 5 MB PNG', expected: 'Compressed to WebP ≤ 200 KB', result: 'pass' },
        { text: 'Crop and save', expected: 'The cropped area is saved', result: 'pass' },
        { text: 'Replace the avatar', expected: 'The old file is deleted from storage', result: 'pass' },
        { text: 'Upload a non-image file', expected: 'A friendly error appears', result: 'pass' },
        { text: 'Check on mobile', expected: 'The cropper is usable on small screens', result: 'pass' }
      ],
      thread: [{ who: 'priya', time: 'Yesterday', html: 'All 5 steps pass. Verified ✅' }]
    }
  ],

  agentLog: [
    { time: '12:41', agent: 'Claude Code', action: 'qa.request_retest', target: 'OTP login flow · step 4' },
    { time: '12:38', agent: 'Claude Code', action: 'git.link_commit', target: '2a91f0e → Fix OTP resend timer' },
    { time: '12:26', agent: 'Claude Code', action: 'tasks.create', target: 'Fix OTP resend timer → Ramin' },
    { time: '12:02', agent: 'Claude Code', action: 'qa.create_handoff', target: 'OTP login flow (4 steps) → Priya' },
    { time: '11:47', agent: 'Claude Code', action: 'inbox.save', target: 'Why sync crypto calls block the event loop' },
    { time: 'Yesterday', agent: 'Claude Code', action: 'tasks.update_status', target: 'Refactor auth middleware → In review' }
  ],

  notifications: [
    { icon: 'bot', tone: 'violet', html: '<b>Claude Code</b> pushed a fix and asked Priya to re-test step 4', time: '4m', route: 'qa' },
    { icon: 'circle-x', tone: 'red', html: '<b>Priya</b> failed step 4 in <b>OTP login flow</b>', time: '18m', route: 'qa' },
    { icon: 'git-pull-request', tone: 'indigo', html: '<b>Arjun</b> requested your review on <b>PR #151</b>', time: '1h', route: 'board' },
    { icon: 'clock', tone: 'amber', html: '3 revisions are overdue. Spread them over the next few days?', time: '8:00', route: 'today' },
    { icon: 'flame', tone: 'amber', html: '12-day streak. One review today keeps it going.', time: '8:00', route: 'review' }
  ],

  cohort: {
    name: 'DSA Placement Sprint', sheet: 'NeetCode 150 · 60 problems selected', day: 9, days: 21, members: 24, active: 19, onTime: 71, coldRate: 58,
    channel: 'Discord · #dsa-sprint',
    forgets: [
      { topic: 'Dijkstra / shortest path', w: [38, 44, 51, 47] },
      { topic: 'Interval DP', w: [40, 37, 35, 28] },
      { topic: 'Trie operations', w: [22, 35, 31, 29] },
      { topic: 'Bit manipulation', w: [18, 26, 30, 33] },
      { topic: 'Monotonic stack', w: [12, 15, 21, 19] },
      { topic: 'Two pointers', w: [9, 8, 6, 5] }
    ],
    nudge: [
      { name: 'Karan S.', last: '5 days ago', due: 14 },
      { name: 'Ananya P.', last: '4 days ago', due: 11 },
      { name: 'Rohit M.', last: '3 days ago', due: 8 }
    ]
  },

  settings: {
    intervals: [1, 3, 7, 21], dailyGoal: 8, amnestyDays: 3, digestTime: '8:00 AM',
    toggles: { digest: true, push: true, overdue: true, mentions: true, qaResults: true, weekly: true, countBack: true }
  }
};
