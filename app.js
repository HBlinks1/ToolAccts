(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var app = document.getElementById('app');
  var IDLE_MS = 20 * 60 * 1000;
  var KEY = 'tc_session';
  var DEPARTMENTS = ['HVAC Service', 'Plumbing', 'HVAC Install', 'Electrical', 'Drain & Sewer', 'MN Electricians'];
  var idleTimer = null;
  var session = null;
  try { session = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { session = null; }

  // ---------- tiny helpers (everything is built with text nodes, never raw HTML) ----------
  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function money(n) {
    var v = Number(n) || 0;
    var s = Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    return v < 0 ? '-' + s : s;
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fdate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function lastDay(y, m) { return new Date(y, m, 0).getDate(); }
  function cls(n) { return Number(n) < 0 ? 'neg' : 'pos'; }
  var TYPE_LABEL = { earning: 'Earned', bonus: 'Bonus', deduction: 'Tool purchase', adjustment: 'Adjustment', reversal: 'Reversal', opening: 'Opening balance',
                     'opening balance': 'Opening balance', 'closing balance': 'Closing balance' };

  // ---------- talking to the server function ----------
  function api(action, body) {
    var headers = { 'Content-Type': 'application/json', 'apikey': CFG.ANON_KEY, 'Authorization': 'Bearer ' + CFG.ANON_KEY };
    if (session && session.token) headers['x-session'] = session.token;
    var payload = JSON.stringify(Object.assign({ action: action }, body || {}));
    return fetch(CFG.API_URL, { method: 'POST', headers: headers, body: payload })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected reply' }; }); })
      .then(function (j) {
        if (j && j.error === 'session') { endSession('Your session ended. Please sign in again.'); return { ok: false, error: 'Your session ended.', ended: true }; }
        return j;
      }, function () { return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; });
  }
  function saveSession(j) {
    session = { token: j.token, kind: j.kind, name: j.name, role: j.role };
    try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch (e) { /* private mode */ }
    armIdle();
  }
  function endSession(message) {
    session = null;
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    clearTimeout(idleTimer);
    showLogin({ message: message, kind: 'info' });
  }
  function signOut() {
    var done = function () { endSession('You are signed out.'); };
    if (session) api('logout').then(done, done); else done();
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (session) signOut(); }, IDLE_MS);
  }
  ['click', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (session) armIdle(); }, { passive: true });
  });

  // ---------- reusable pieces ----------
  function screen() { app.textContent = ''; return app; }
  function alertBox(text, kind) { return text ? h('div', { class: 'alert ' + (kind || 'err'), role: kind === 'err' || !kind ? 'alert' : 'status' }, text) : null; }
  function field(label, input, hint) {
    var id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return h('div', null, h('label', { for: id }, label), input, hint ? h('div', { class: 'small muted' }, hint) : null);
  }
  function modal(title, body, buttons) {
    return new Promise(function (resolve) {
      var back = h('div', { class: 'modalback', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
      function close(v) { document.removeEventListener('keydown', onKey); back.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      var actions = h('div', { class: 'actions' }, (buttons || [{ label: 'Close', value: null }]).map(function (b) {
        return h('button', { type: 'button', class: b.primary ? 'primary' : (b.danger ? 'danger' : ''), onclick: function () {
          if (b.check && !b.check()) return;
          close(b.value === undefined ? true : b.value);
        } }, b.label);
      }));
      back.appendChild(h('div', { class: 'modal' }, h('h2', null, title), body, actions));
      back.addEventListener('click', function (e) { if (e.target === back) close(null); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      var first = back.querySelector('input,select,textarea,button');
      if (first) first.focus();
    });
  }
  function codeModal(who, code) {
    return modal('Setup code for ' + who, h('div', null,
      h('p', null, 'Give this code to ' + who + ' in person or by phone. It works one time and expires in 3 days.'),
      h('div', { class: 'code' }, code),
      h('p', { class: 'small muted' }, 'They enter their email and this code on the sign-in page (First time or forgot your PIN) and choose their own PIN. Anyone who has this code can set the PIN, so hand it over privately.')));
  }

  // ---------- sign in ----------
  var loginMode = 'tech';
  function showLogin(opts) {
    opts = opts || {};
    var setup = !!opts.setup;
    var isTech = loginMode === 'tech';
    var root = screen();
    var email = h('input', { type: 'email', autocomplete: 'username', required: true, inputmode: 'email', autocapitalize: 'off', spellcheck: 'false' });
    var secret = h('input', isTech
      ? { type: 'password', inputmode: 'numeric', maxlength: '6', pattern: '[0-9]*', autocomplete: setup ? 'new-password' : 'current-password', required: true }
      : { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true });
    var code = h('input', { type: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', maxlength: '12' });
    var again = h('input', isTech
      ? { type: 'password', inputmode: 'numeric', maxlength: '6', pattern: '[0-9]*', autocomplete: 'new-password' }
      : { type: 'password', autocomplete: 'new-password' });
    var msg = h('div');
    var btn = h('button', { type: 'submit', class: 'primary full' }, setup ? (isTech ? 'Set my PIN and sign in' : 'Set my password and sign in') : 'Sign in');

    function show(text, kind) { msg.textContent = ''; var a = alertBox(text, kind); if (a) msg.appendChild(a); }
    var form = h('form', { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      if (!email.value.trim() || !secret.value) { show('Please fill in every box.'); return; }
      if (setup) {
        if (!code.value.trim()) { show('Please enter the setup code you were given.'); return; }
        if (secret.value !== again.value) { show((isTech ? 'The two PINs do not match.' : 'The two passwords do not match.')); return; }
      }
      btn.disabled = true; show('Checking…', 'info');
      var action = (isTech ? 'tech_' : 'staff_') + (setup ? 'setup' : 'login');
      var body = { email: email.value.trim(), secret: secret.value };
      if (setup) body.code = code.value.trim();
      api(action, body).then(function (j) {
        if (j && j.ok) { saveSession(j); render(); }
        else { btn.disabled = false; show(j && j.error ? j.error : 'That did not work.'); secret.value = ''; again.value = ''; }
      }, function () { btn.disabled = false; });
    } },
      field('Email', email),
      setup ? field('Setup code', code, 'From the warehouse or office. Example: ABCD-EFGH') : null,
      field(setup ? (isTech ? 'Choose a 6 digit PIN' : 'Choose a password (10 or more characters)') : (isTech ? 'PIN' : 'Password'), secret),
      setup ? field(isTech ? 'Type the PIN again' : 'Type the password again', again) : null,
      msg, btn);

    var tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Who is signing in' },
      h('button', { type: 'button', 'aria-pressed': String(isTech), onclick: function () { loginMode = 'tech'; showLogin({ setup: setup }); } }, 'Technician'),
      h('button', { type: 'button', 'aria-pressed': String(!isTech), onclick: function () { loginMode = 'staff'; showLogin({ setup: setup }); } }, 'Warehouse / Office'));
    var card = h('div', { class: 'card' }, h('h1', null, 'Tool Account'),
      h('p', { class: 'muted' }, setup ? 'First time here, or forgot your ' + (isTech ? 'PIN' : 'password') + '? Use the setup code you were given.' : 'Sign in to see your balance.'),
      tabs, form,
      h('div', { style: 'margin-top:10px' }, h('button', { type: 'button', class: 'link', onclick: function () { showLogin({ setup: !setup }); } },
        setup ? 'Back to sign in' : 'First time, or forgot your ' + (isTech ? 'PIN' : 'password') + '?')));
    root.appendChild(h('div', { class: 'wrap narrow' }, opts.message ? alertBox(opts.message, opts.kind || 'info') : null, card));
    email.focus();
  }

  // ---------- statements (shared by technicians and staff) ----------
  function monthOptions() {
    var now = new Date(); var opts = [{ label: 'Last 12 months', from: null, to: null }];
    for (var i = 0; i < 12; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var y = d.getFullYear(), m = d.getMonth() + 1;
      opts.push({ label: MONTHS[m - 1] + ' ' + y, from: y + '-' + pad(m) + '-01', to: y + '-' + pad(m) + '-' + pad(lastDay(y, m)) });
    }
    var d0 = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    opts[0].from = d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-01'; opts[0].to = today();
    opts.push({ label: 'Everything', from: '2025-12-31', to: today() });
    return opts;
  }
  function statementPanel(load) {
    var opts = monthOptions();
    var sel = h('select', { 'aria-label': 'Period' }, opts.map(function (o, i) { return h('option', { value: String(i), selected: i === 1 }, o.label); }));
    var out = h('div');
    function go() {
      var o = opts[Number(sel.value)];
      out.textContent = ''; out.appendChild(h('p', { class: 'muted' }, 'Loading…'));
      load(o.from, o.to).then(function (st) {
        out.textContent = '';
        if (!st) { out.appendChild(alertBox('Could not load the statement.')); return; }
        var lines = st.lines || [];
        out.appendChild(h('div', { class: 'strip' },
          h('div', null, 'Earned', h('b', { class: 'pos' }, money(st.earned))),
          h('div', null, 'Tool purchases', h('b', { class: Number(st.deducted) < 0 ? 'neg' : '' }, money(st.deducted))),
          h('div', null, 'Adjustments', h('b', { class: Number(st.adjusted) < 0 ? 'neg' : '' }, money(st.adjusted)))));
        var rows = lines.map(function (l) {
          var edge = l.type === 'opening balance' || l.type === 'closing balance';
          return h('tr', { class: edge ? 'edge' : '' },
            h('td', null, fdate(l.date)),
            h('td', null, edge ? (TYPE_LABEL[l.type]) : h('span', null, l.description || '', h('div', { class: 'small muted' }, TYPE_LABEL[l.type] || l.type))),
            h('td', { class: 'num ' + (edge ? '' : cls(l.amount)) }, edge ? '' : money(l.amount)),
            h('td', { class: 'num' }, money(l.balance)));
        });
        out.appendChild(h('div', { class: 'tablewrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Detail'), h('th', { class: 'num' }, 'Amount'), h('th', { class: 'num' }, 'Balance'))),
          h('tbody', null, rows))));
        if (lines.length <= 2) out.appendChild(h('p', { class: 'muted' }, 'Nothing posted in this period.'));
      });
    }
    sel.addEventListener('change', go);
    go();
    return h('div', null, h('div', { style: 'max-width:260px' }, field('Show', sel)), out);
  }

  // ---------- technician screen ----------
  function techScreen() {
    var root = screen();
    var wrap = h('div', { class: 'wrap' });
    root.appendChild(wrap);
    wrap.appendChild(h('div', { class: 'top' }, h('div', null, h('h1', null, 'Hi, ' + session.name), h('div', { class: 'muted', id: 'dept' }, ' ')),
      h('button', { type: 'button', onclick: signOut }, 'Sign out')));
    var bal = h('div', { class: 'balance' }, '…');
    wrap.appendChild(h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Tool account balance'), bal,
      h('div', { class: 'small muted' }, 'Updated every night. Earnings post the day after the work is invoiced.')));
    api('tech_overview').then(function (j) {
      if (!j || !j.ok) return;
      bal.textContent = money(j.overview.balance); bal.className = 'balance ' + cls(j.overview.balance);
      document.getElementById('dept').textContent = j.overview.department;
    }, function () {});
    wrap.appendChild(h('div', { class: 'card' }, h('h2', null, 'Statement'), statementPanel(function (from, to) {
      return api('tech_statement', { from: from, to: to }).then(function (j) { return j && j.ok ? j.statement : null; });
    })));
    wrap.appendChild(h('p', { class: 'small muted' }, 'Something look wrong? Ask the warehouse and they can check it.'));
  }

  // ---------- staff screen ----------
  var staffTab = 'add';
  var techCache = null;
  function loadTechs(force) {
    if (techCache && !force) return Promise.resolve(techCache);
    return api('techs').then(function (j) { techCache = (j && j.ok) ? j.techs : []; return techCache; });
  }
  function staffScreen() {
    var isAdmin = session.role === 'admin';
    var tabs = [['add', 'Add entry'], ['recent', 'Recent entries'], ['techs', 'Technicians']];
    if (isAdmin) tabs = tabs.concat([['roster', 'Roster'], ['feed', 'Nightly pull'], ['staff', 'Staff'], ['close', 'Close month']]);
    if (tabs.every(function (t) { return t[0] !== staffTab; })) staffTab = 'add';
    var root = screen();
    var body = h('div');
    root.appendChild(h('div', { class: 'wrap' },
      h('div', { class: 'top' }, h('div', null, h('h1', null, 'Tool Account'), h('div', { class: 'muted' }, session.name + ' (' + (isAdmin ? 'admin' : 'warehouse') + ')')),
        h('button', { type: 'button', onclick: signOut }, 'Sign out')),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { type: 'button', role: 'tab', 'aria-selected': String(staffTab === t[0]), onclick: function () { staffTab = t[0]; staffScreen(); } }, t[1]);
      })), body));
    var views = { add: addEntryView, recent: recentView, techs: techsView, roster: rosterView, feed: feedView, staff: staffView, close: closeView };
    body.appendChild(h('p', { class: 'muted' }, 'Loading…'));
    Promise.resolve(views[staffTab]()).then(function (node) { body.textContent = ''; body.appendChild(node); });
  }

  function techSelect(techs, includeInactive) {
    var list = techs.filter(function (t) { return includeInactive || t.active; });
    return h('select', { required: true }, h('option', { value: '' }, 'Choose a technician…'),
      list.map(function (t) { return h('option', { value: t.id }, t.name + ' (' + t.department + ')' + (t.active ? '' : ' - inactive')); }));
  }

  function addEntryView() {
    var isAdmin = session.role === 'admin';
    return loadTechs(true).then(function (techs) {
      var kinds = [['purchase', 'Tool purchase'], ['return', 'Return or credit']];
      if (isAdmin) kinds = kinds.concat([['earning', 'Install earnings'], ['adjustment', 'Adjustment']]);
      var kind = 'purchase';
      var tech = techSelect(techs, isAdmin);
      var date = h('input', { type: 'date', value: today(), max: today(), required: true });
      var amount = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true });
      var item = h('input', { type: 'text', maxlength: '300' });
      var vendor = h('input', { type: 'text', maxlength: '100' });
      var po = h('input', { type: 'text', maxlength: '50' });
      var order = h('input', { type: 'text', maxlength: '50' });
      var note = h('input', { type: 'text', maxlength: '300' });
      var msg = h('div');
      var fieldsBox = h('div');
      var segBox = h('div', { class: 'seg', role: 'group', 'aria-label': 'Entry type' });
      function paintFields() {
        var simple = kind === 'purchase' || kind === 'return';
        fieldsBox.textContent = '';
        amount.removeAttribute('min');
        if (kind !== 'adjustment') amount.setAttribute('min', '0');
        fieldsBox.appendChild(h('div', { class: 'row two' }, field(kind === 'adjustment' ? 'Amount (use a minus sign to take money off)' : 'Amount', amount)));
        if (simple) {
          fieldsBox.appendChild(field(kind === 'purchase' ? 'What was bought' : 'What was returned', item));
          fieldsBox.appendChild(h('div', { class: 'row three' }, field('Vendor (optional)', vendor), field('PO (optional)', po), field('Order # (optional)', order)));
        } else {
          fieldsBox.appendChild(field(kind === 'earning' ? 'Note (job or reason)' : 'Why is this being adjusted?', note));
        }
      }
      function paintSeg() {
        segBox.textContent = '';
        kinds.forEach(function (k) {
          segBox.appendChild(h('button', { type: 'button', 'aria-pressed': String(kind === k[0]), onclick: function () { kind = k[0]; paintSeg(); paintFields(); } }, k[1]));
        });
      }
      paintSeg(); paintFields();
      var form = h('form', { novalidate: true, onsubmit: function (e) {
        e.preventDefault(); msg.textContent = '';
        var fail = function (t) { msg.appendChild(alertBox(t)); };
        if (!tech.value) return fail('Choose a technician.');
        var amt = Number(amount.value);
        if (!amount.value || !isFinite(amt) || amt === 0) return fail('Enter an amount.');
        if (kind !== 'adjustment' && amt < 0) return fail('Enter the amount as a positive number.');
        var simple = kind === 'purchase' || kind === 'return';
        if (simple && !item.value.trim()) return fail('Describe the item.');
        if (!simple && note.value.trim().length < (kind === 'adjustment' ? 5 : 1)) return fail('Please add a note.');
        var techName = tech.options[tech.selectedIndex].text;
        var verb = { purchase: 'Charge', 'return': 'Credit', earning: 'Add install earnings of', adjustment: 'Adjust by' }[kind];
        modal('Please confirm', h('div', null, h('p', null, verb + ' ' + money(amt) + (kind === 'purchase' ? ' to ' : ' for ') + techName + ' dated ' + fdate(date.value) + '?'),
          h('p', { class: 'small muted' }, 'Entries cannot be edited. A mistake is fixed with a reversal by an admin.')),
          [{ label: 'Cancel', value: false }, { label: 'Post it', value: true, primary: true }]).then(function (yes) {
          if (!yes) return;
          api('add_entry', { kind: kind, tech_id: tech.value, date: date.value, amount: amt, item: item.value, vendor: vendor.value, po: po.value, order_no: order.value, note: note.value })
            .then(function (j) {
              if (!j || !j.ok) return fail(j && j.error ? j.error : 'That did not post.');
              loadTechs(true).then(function (ts) {
                var t = ts.filter(function (x) { return x.id === tech.value; })[0];
                msg.appendChild(alertBox('Posted. ' + techName.replace(/ \(.*/, '') + ' now has ' + (t ? money(t.balance) : 'an updated balance') + '.', 'ok'));
              });
              amount.value = ''; item.value = ''; vendor.value = ''; po.value = ''; order.value = ''; note.value = '';
            }, function () {});
        });
      } }, field('Technician', tech), field('Date', date), fieldsBox, msg, h('button', { type: 'submit', class: 'primary full' }, 'Review and post'));
      return h('div', { class: 'card' }, h('h2', null, 'Add an entry'), segBox, form);
    });
  }

  function recentView() {
    var isAdmin = session.role === 'admin';
    return api('recent_entries', { limit: 60 }).then(function (j) {
      var entries = (j && j.ok) ? j.entries : [];
      var rows = entries.map(function (e) {
        var canReverse = isAdmin && e.type !== 'reversal' && !e.reversed;
        return h('tr', null,
          h('td', null, fdate(e.date)), h('td', null, e.tech, h('div', { class: 'small muted' }, e.department)),
          h('td', null, e.description || '', h('div', { class: 'small muted' }, (TYPE_LABEL[e.type] || e.type) + (e.reversed ? ' - reversed' : '') +
            (e.vendor ? ' - ' + e.vendor : '') + (e.po ? ' - PO ' + e.po : '') + (e.order_no ? ' - order ' + e.order_no : ''))),
          h('td', { class: 'num ' + cls(e.amount) }, money(e.amount)), h('td', { class: 'small muted' }, e.created_by || ''),
          h('td', null, canReverse ? h('button', { type: 'button', class: 'small danger', onclick: function () { reverseFlow(e); } }, 'Reverse') : ''));
      });
      return h('div', { class: 'card' }, h('h2', null, 'Recent entries'),
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Technician'), h('th', null, 'Detail'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'By'), h('th', null, ''))), h('tbody', null, rows))),
        entries.length ? null : h('p', { class: 'muted' }, 'Nothing yet.'));
    });
  }
  function reverseFlow(e) {
    var reason = h('input', { type: 'text', maxlength: '300' });
    var err = h('div');
    modal('Reverse this entry?', h('div', null,
      h('p', null, e.tech + ': ' + (e.description || '') + ' for ' + money(e.amount) + ' on ' + fdate(e.date)),
      h('p', { class: 'small muted' }, 'This adds an opposite entry dated today and keeps the original on record.'),
      field('Why? (required)', reason), err),
      [{ label: 'Cancel', value: false }, { label: 'Reverse it', value: true, danger: true, check: function () {
        err.textContent = '';
        if (reason.value.trim().length < 5) { err.appendChild(alertBox('Please explain why, in a few words.')); return false; }
        return true; } }]).then(function (yes) {
      if (!yes) return;
      api('reverse_entry', { entry_id: e.id, reason: reason.value }).then(function (j) {
        if (j && j.ok) { techCache = null; staffScreen(); } else modal('Could not reverse it', h('p', null, (j && j.error) || 'That did not work.'));
      }, function () {});
    });
  }

  function techsView() {
    return loadTechs(true).then(function (techs) {
      var q = h('input', { type: 'search', placeholder: 'Search by name or department', 'aria-label': 'Search technicians' });
      var tbody = h('tbody');
      var detail = h('div');
      function paint() {
        var term = q.value.trim().toLowerCase();
        tbody.textContent = '';
        techs.filter(function (t) { return !term || (t.name + ' ' + t.department).toLowerCase().indexOf(term) >= 0; }).forEach(function (t) {
          tbody.appendChild(h('tr', null, h('td', null, h('button', { type: 'button', class: 'link', onclick: function () { openTech(t); } }, t.name), t.active ? '' : h('span', { class: 'pill' }, 'inactive')),
            h('td', null, t.department), h('td', { class: 'num ' + cls(t.balance) }, money(t.balance))));
        });
      }
      function openTech(t) {
        detail.textContent = '';
        detail.appendChild(h('div', { class: 'card' }, h('h2', null, t.name + ' - ' + money(t.balance)), h('div', { class: 'muted' }, t.department),
          statementPanel(function (from, to) { return api('tech_view', { tech_id: t.id, from: from, to: to }).then(function (j) { return j && j.ok ? j.statement : null; }); })));
        detail.scrollIntoView && detail.scrollIntoView();
      }
      q.addEventListener('input', paint); paint();
      return h('div', null, h('div', { class: 'card' }, h('h2', null, 'Technicians'), q,
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Department'), h('th', { class: 'num' }, 'Balance'))), tbody))), detail);
    });
  }

  function rosterView() {
    return api('roster').then(function (j) {
      var roster = (j && j.ok) ? j.roster : [];
      var rows = roster.map(function (t) {
        return h('tr', null,
          h('td', null, t.display_name, t.active ? '' : h('span', { class: 'pill' }, 'inactive')),
          h('td', null, t.department), h('td', null, t.st_name || h('span', { class: 'muted' }, '-')), h('td', null, t.email || h('span', { class: 'muted' }, '-')),
          h('td', null, t.earns_from_feed ? 'Automatic' : 'By hand'),
          h('td', null, t.locked ? h('span', { class: 'pill bad' }, 'locked') : (t.has_pin ? h('span', { class: 'pill ok' }, 'PIN set') : h('span', { class: 'pill warn' }, 'no PIN'))),
          h('td', null, h('button', { type: 'button', class: 'small', onclick: function () { editTech(t); } }, 'Edit'), ' ',
            t.email && t.active ? h('button', { type: 'button', class: 'small', onclick: function () { issueCode('tech_code', { tech_id: t.id }, t.display_name); } }, 'Setup code') : ''));
      });
      return h('div', { class: 'card' }, h('div', { class: 'top' }, h('h2', null, 'Roster'), h('button', { type: 'button', class: 'primary', onclick: function () { editTech(null); } }, 'Add technician')),
        h('p', { class: 'small muted' }, 'The ServiceTitan name must match exactly how it shows in ServiceTitan, or that tech\'s earnings will not post. "Setup code" is how a tech gets or resets their PIN.'),
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Name', 'Department', 'ServiceTitan name', 'Email', 'Earnings', 'Login', ''].map(function (x) { return h('th', null, x); }))), h('tbody', null, rows))));
    });
  }
  function issueCode(action, body, who) {
    api(action, body).then(function (j) {
      if (j && j.ok) { codeModal(who, j.code); rerender(); }
      else modal('Could not make a code', h('p', null, (j && j.error) || 'That did not work.'));
    }, function () {});
  }
  function rerender() { techCache = null; staffScreen(); }
  function editTech(t) {
    var isNew = !t;
    var name = h('input', { type: 'text', maxlength: '60', value: t ? t.display_name : '' });
    var dept = h('select', null, DEPARTMENTS.map(function (d) { return h('option', { value: d, selected: t && t.department === d }, d); }));
    var st = h('input', { type: 'text', maxlength: '60', value: t ? (t.st_name || '') : '' });
    var email = h('input', { type: 'email', maxlength: '120', value: t ? (t.email || '') : '' });
    var role = h('select', null, ['lead', 'apprentice'].map(function (r) { return h('option', { value: r, selected: t && t.role === r }, r === 'lead' ? 'Lead / regular' : 'Apprentice'); }));
    var active = h('select', null, h('option', { value: 'true', selected: !t || t.active }, 'Active'), h('option', { value: 'false', selected: t && !t.active }, 'Inactive (left the company)'));
    var feed = h('select', null, h('option', { value: 'true', selected: !t || t.earns_from_feed }, 'Automatic (from ServiceTitan)'), h('option', { value: 'false', selected: t && !t.earns_from_feed }, 'By hand (Install)'));
    var err = h('div');
    modal(isNew ? 'Add a technician' : 'Edit ' + t.display_name, h('div', null,
      field('Name as shown in the tool account', name), field('Department', dept),
      field('Name in ServiceTitan', st, 'Exactly as it appears in ServiceTitan, for example "Dan S".'), field('Email (their login)', email),
      h('div', { class: 'row two' }, field('Role', role), field('Status', active)), field('Earnings', feed), err),
      [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true, check: function () {
        err.textContent = ''; if (!name.value.trim()) { err.appendChild(alertBox('A name is required.')); return false; } return true; } }]).then(function (yes) {
      if (!yes) return;
      var body = { display_name: name.value, department: dept.value, st_name: st.value, email: email.value, role: role.value, active: active.value === 'true', earns_from_feed: feed.value === 'true' };
      if (t) body.id = t.id;
      api('roster_save', body).then(function (j) {
        if (j && j.ok) rerender(); else modal('Could not save', h('p', null, (j && j.error) || 'That did not work.'));
      }, function () {});
    });
  }

  function feedView() {
    return api('feed_status').then(function (j) {
      var s = (j && j.ok) ? j.status : { runs: [], unmapped: [], last_pull: null };
      var lp = s.last_pull;
      var runs = (s.runs || []).map(function (r) {
        var good = r.status === 'ok';
        return h('tr', null, h('td', null, fdate(r.run_for)), h('td', { class: 'num' }, r.st_lines), h('td', { class: 'num' }, r.posted_lines), h('td', { class: 'num' }, money(r.st_dollars)),
          h('td', { class: 'num' }, money(r.posted_dollars)), h('td', null, h('span', { class: 'pill ' + (good ? 'ok' : (r.status === 'MISMATCH' ? 'bad' : 'warn')) }, r.status)));
      });
      var un = (s.unmapped || []).map(function (u) {
        return h('tr', null, h('td', null, fdate(u.invoice_date)), h('td', null, u.invoice_no || ''), h('td', null, u.job_no || ''), h('td', null, u.item_code), h('td', { class: 'num' }, money(u.total)), h('td', null, u.reason));
      });
      return h('div', null,
        h('div', { class: 'card' }, h('h2', null, 'Nightly pull'),
          lp ? h('p', null, 'Last run: ' + String(lp.at).slice(0, 16).replace('T', ' ') + ' UTC. ', h('span', { class: 'pill ' + (lp.status === 'ok' ? 'ok' : 'bad') }, lp.status), lp.error ? h('div', { class: 'small neg' }, lp.error) : null)
             : h('p', { class: 'muted' }, 'No runs yet.'),
          h('p', { class: 'small muted' }, 'Each night: ServiceTitan lines versus what was posted to the ledger. Anything other than "ok" needs a look.'),
          h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Day', 'ST lines', 'Posted lines', 'ST dollars', 'Posted dollars', 'Status'].map(function (x) { return h('th', null, x); }))), h('tbody', null, runs))),
          (s.runs || []).length ? null : h('p', { class: 'muted' }, 'Nothing yet. The first night after the cutover will show up here.')),
        h('div', { class: 'card' }, h('h2', null, 'Lines that could not be matched to a technician'),
          un.length ? h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Date', 'Invoice', 'Job', 'Item', 'Amount', 'Why'].map(function (x) { return h('th', null, x); }))), h('tbody', null, un)))
                    : h('p', { class: 'muted' }, 'None. Every line found a technician.'),
          un.length ? h('p', { class: 'small muted' }, 'Fix by adding or correcting the ServiceTitan name on the Roster tab. The next nightly run will pick the lines up.') : null));
    });
  }

  function staffView() {
    return api('staff_list').then(function (j) {
      var staff = (j && j.ok) ? j.staff : [];
      var rows = staff.map(function (s) {
        return h('tr', null, h('td', null, s.name, s.active ? '' : h('span', { class: 'pill' }, 'off')), h('td', null, s.email), h('td', null, s.role === 'admin' ? 'Admin' : 'Warehouse'),
          h('td', null, s.locked ? h('span', { class: 'pill bad' }, 'locked') : (s.has_password ? h('span', { class: 'pill ok' }, 'set') : h('span', { class: 'pill warn' }, 'no password'))),
          h('td', null, h('button', { type: 'button', class: 'small', onclick: function () { issueCode('staff_code', { staff_id: s.id }, s.name); } }, 'Setup code'), ' ',
            h('button', { type: 'button', class: 'small ' + (s.active ? 'danger' : ''), onclick: function () {
              api('staff_set_active', { staff_id: s.id, active: !s.active }).then(function (r) { if (r && r.ok) rerender(); else modal('Could not change it', h('p', null, (r && r.error) || 'That did not work.')); }, function () {});
            } }, s.active ? 'Turn off' : 'Turn on')));
      });
      var name = h('input', { type: 'text', maxlength: '60' }), email = h('input', { type: 'email', maxlength: '120' });
      var role = h('select', null, h('option', { value: 'warehouse' }, 'Warehouse (adds purchases and returns)'), h('option', { value: 'admin' }, 'Admin (everything)'));
      var msg = h('div');
      return h('div', null, h('div', { class: 'card' }, h('h2', null, 'Warehouse and office logins'),
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Name', 'Email', 'Access', 'Password', ''].map(function (x) { return h('th', null, x); }))), h('tbody', null, rows)))),
        h('div', { class: 'card' }, h('h2', null, 'Add someone'), h('form', { novalidate: true, onsubmit: function (e) {
          e.preventDefault(); msg.textContent = '';
          if (!name.value.trim() || !email.value.trim()) { msg.appendChild(alertBox('Name and email are required.')); return; }
          api('staff_add', { name: name.value, email: email.value, role: role.value }).then(function (r) {
            if (r && r.ok) { codeModal(name.value.trim(), r.code); rerender(); } else msg.appendChild(alertBox((r && r.error) || 'That did not work.'));
          }, function () {});
        } }, field('Name', name), field('Email', email), field('Access', role), msg, h('button', { type: 'submit', class: 'primary full' }, 'Add and get a setup code'))));
    });
  }

  function closeView() {
    var now = new Date();
    var opts = [];
    for (var i = 1; i <= 14; i++) { var d = new Date(now.getFullYear(), now.getMonth() - i, 1); opts.push([d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01', MONTHS[d.getMonth()] + ' ' + d.getFullYear()]); }
    opts.reverse();
    var sel = h('select', null, opts.map(function (o, i) { return h('option', { value: o[0], selected: i === opts.length - 1 }, o[1]); }));
    var msg = h('div');
    return h('div', { class: 'card' }, h('h2', null, 'Close a month'),
      h('p', null, 'Closing a month locks it for good. Nothing can be posted into it afterward, and corrections go in the current month with a note. Close months oldest first, once you are sure they are settled.'),
      field('Month to close', sel), msg,
      h('button', { type: 'button', class: 'danger full', onclick: function () {
        msg.textContent = '';
        var typed = h('input', { type: 'text', autocomplete: 'off' });
        modal('Close ' + sel.options[sel.selectedIndex].text + '?', h('div', null, h('p', null, 'This cannot be undone. Type CLOSE to confirm.'), typed),
          [{ label: 'Cancel', value: false }, { label: 'Close the month', value: true, danger: true, check: function () { return typed.value.trim() === 'CLOSE'; } }]).then(function (yes) {
          if (!yes) return;
          api('close_period', { month: sel.value }).then(function (j) {
            msg.appendChild(j && j.ok ? alertBox(sel.options[sel.selectedIndex].text + ' is closed.', 'ok') : alertBox((j && j.error) || 'That did not work.'));
          }, function () {});
        });
      } }, 'Close this month'));
  }

  // ---------- start ----------
  function render() {
    if (!session) { showLogin(); return; }
    armIdle();
    if (session.kind === 'tech') techScreen(); else staffScreen();
  }
  if (session) {
    api('me').then(function (j) { if (j && j.ok) render(); else endSession(); }, function () { /* session handler already showed login */ });
  } else {
    showLogin();
  }
})();
