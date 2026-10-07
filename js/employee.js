// Карточка сотрудника: баланс, полоса года, отпуска, конфликты, пары, действующие правила.
(function() {
  'use strict';

  const VS = window.VS;
  const { data, derived, ui, esc, ST } = VS;

  // Фамилия в родительном падеже для кнопки «+ Отпуск для …» (упрощённо)
  function surnameGen(name) {
    const s = name.trim().split(/\s+/)[0] || '';
    if (/(ова|ева|ёва|ина|ына)$/i.test(s)) return s.slice(0, -1) + 'ой';
    if (/(ая)$/i.test(s)) return s.slice(0, -2) + 'ой';
    if (/(ов|ев|ёв|ин|ын)$/i.test(s)) return s + 'а';
    if (/(ий|ой)$/i.test(s)) return s.slice(0, -2) + 'ого';
    return s;
  }

  // Творительный падеж «С Ковалёвым Д.» — только для типичных фамилий, иначе как есть
  function withShort(id) {
    const short = VS.empShort(id);
    const [sur, ini = ''] = short.split(' ');
    let t = sur;
    if (/(ова|ева|ёва|ина|ына)$/i.test(sur)) t = sur.slice(0, -1) + 'ой';
    else if (/(ов|ев|ёв|ин|ын)$/i.test(sur)) t = sur + 'ым';
    return (t + ' ' + ini).trim();
  }

  const swatch = k => `<span class="sw ${ST[k].cls}"></span>`;

  function render() {
    const e = VS.emp(ui.employeeId);
    if (!e) { ui.view = 'timeline'; return VS.views.timeline.render(); }
    const b = VS.balance(e.id), t = b.total || 1;
    const groups = VS.groupsOf(e.id);
    const vacs = data.vacations.filter(v => v.employeeId === e.id).sort((x, y) => x.start < y.start ? -1 : 1);

    // проверка «часть ≥ 14 дней»
    const longest = VS.longestPart(e.id);
    const part14 = !longest ? '<span class="faint">нет запланированных отпусков</span>'
      : VS.vacDays(longest) >= 14 ? `<span class="check-ok">выполнено</span> (${VS.fmtRange(longest.start, longest.end)})`
      : `<span class="check-bad">не выполнено</span> (самая длинная часть — ${VS.vacDays(longest)} дн)`;

    // полоса года по месяцам
    const YD = VS.YEAR_DAYS, py = i => i / YD * 100;
    const strip = VS.MONTHS_SHORT.map((l, k) => {
      const s = VS.monthStartDoy(k), en = VS.monthStartDoy(k + 1);
      return `<div class="m" style="left:${py(s)}%;width:${(en - s) / YD * 100}%">${l}</div>`;
    }).join('') + vacs.filter(v => VS.doy(v.end) >= 0 && VS.doy(v.start) < YD).map(v => {
      const s = Math.max(0, VS.doy(v.start)), en = Math.min(YD - 1, VS.doy(v.end));
      return `<div class="b ${ST[VS.statusKey(v.status)].cls}" style="left:${py(s)}%;width:${(en - s + 1) / YD * 100}%" title="${VS.fmtRange(v.start, v.end)}"></div>`;
    }).join('');

    const rows = vacs.map(v => {
      const k = VS.statusKey(v.status);
      return `<div class="tr">
        <span class="mono">${VS.fmtRangeNum(v.start, v.end)}</span>
        <span class="mono">${VS.vacDays(v)}</span>
        <span style="display:flex;align-items:center;gap:6px">${swatch(k)}${ST[k].label}</span>
        <span class="acts"><a data-act="vac-edit" data-id="${v.id}">Изменить</a><a data-act="vac-del" data-id="${v.id}" style="color:var(--err-text)">Удалить</a></span>
      </div>`;
    }).join('') || '<div class="tr"><span class="faint">Отпусков пока нет</span></div>';

    // конфликты сотрудника
    const confs = derived.conflicts.filter(c => c.ids.includes(e.id));
    const confLines = confs.map(c => {
      let wd = 0;
      for (let d = c.s; d <= c.e; d = VS.addDays(d, 1)) if (VS.isWorkingDay(d)) wd++;
      const who = c.type === 'pair' ? 'С ' + withShort(c.a === e.id ? c.b : c.a)
        : `Группа «${esc((data.groups.find(g => g.id === c.groupId) || {}).name || '')}»`;
      return `<span>${esc(who)} — ${VS.fmtRange(c.s, c.e)}. Рабочих дней пересечения: ${wd}.</span>`;
    }).join('');
    const confBlock = confs.length
      ? `<div class="side-warn"><b>${confs.length} ${VS.plural(confs.length, ['конфликт', 'конфликта', 'конфликтов'])}</b>${confLines}<a data-act="emp-show-conf">Показать на таймлайне</a></div>`
      : '<div class="side-ok">Конфликтов нет</div>';

    const partners = VS.pairPartners(e.id).map(o => `<div class="list-row"><a data-act="open-emp" data-id="${o}" style="color:var(--text)">${esc((VS.emp(o) || {}).name || '?')}</a><button type="button" class="btn-x" data-act="pair-del" data-a="${e.id}" data-b="${o}" title="Удалить пару">×</button></div>`).join('')
      || '<div class="empty-note">Ограничений нет</div>';

    const rules = groups.map(g => `<div class="rule-item"><span>${esc(g.name)}: не больше ${g.maxConcurrent} одновременно</span><span>группа из ${g.memberIds.length} ${VS.plural(g.memberIds.length, ['человека', 'человек', 'человек'])}</span></div>`).join('')
      + data.blackouts.map(bo => `<div class="rule-item"><span>${esc(bo.name)}, ${VS.fmtRange(bo.start, bo.end)}</span><span>отпуск запрещён</span></div>`).join('');

    const sub = (groups.length ? `Группа ${groups.map(g => `«${esc(g.name)}»`).join(', ')}` : 'Без группы') + ` · лимит <b>${b.total}</b> дн на ${VS.YEAR}`;

    return `<div class="emp-page" data-keep-scroll="emp">
      <div class="crumbs"><a data-act="go-tl">← Таймлайн</a><span>/</span><span>Сотрудники</span></div>
      <div class="emp-title">
        <div><div class="fio">${esc(e.name)}</div><div class="sub">${sub}</div></div>
        <div class="acts">
          <button type="button" class="btn btn-strong" data-act="emp-edit">Изменить</button>
          <button type="button" class="btn btn-danger-text" data-act="emp-del">Удалить</button>
          <button type="button" class="btn btn-primary" data-act="emp-new-vac">+ Отпуск для ${esc(surnameGen(e.name))}</button>
        </div>
      </div>
      <div class="emp-grid">
        <div class="emp-col">
          <div class="card bal-card">
            <div class="bal4">
              <div><b>${b.total}</b><span><span class="sw" style="background:#fff;border:1px solid var(--border-strong)"></span>лимит</span></div>
              <div><b>${b.used}</b><span>${swatch('U')}использовано</span></div>
              <div><b>${b.plan}</b><span>${swatch('P')}в плане</span></div>
              <div><b class="${b.left < 0 ? 'neg' : 'ok'}">${b.left}</b><span><span class="sw" style="background:var(--divider)"></span>не распределено</span></div>
            </div>
            <div class="balbar lg"><div class="u" style="width:${Math.min(100, b.used / t * 100)}%"></div><div class="p" style="width:${Math.min(100, b.plan / t * 100)}%"></div></div>
            <div style="font-size:12px;color:var(--text-2)">Одна из частей отпуска — не менее 14 дней: ${part14}</div>
          </div>
          <div class="card strip-card">
            <div class="section-title">${VS.YEAR} по месяцам</div>
            <div class="strip">${strip}</div>
          </div>
          <div class="card vac-table">
            <div class="tr th"><span>Период</span><span>Дней</span><span>Статус</span><span></span></div>
            ${rows}
          </div>
        </div>
        <div class="emp-col side">
          ${confBlock}
          <div class="card side-card">
            <div class="section-title">Нельзя отсутствовать вместе</div>
            ${partners}
            <button type="button" class="btn-dashed" data-act="emp-pair-add">+ Добавить</button>
          </div>
          <div class="card side-card">
            <div class="section-title">Действующие правила</div>
            ${rules || '<div class="empty-note">Нет групп и запретных периодов</div>'}
            <a data-act="go-rules" style="font-size:12px">Все правила →</a>
          </div>
        </div>
      </div>
    </div>`;
  }

  Object.assign(VS.act, {
    'go-tl': () => VS.go('timeline'),
    'emp-edit': () => VS.employeeModal(ui.employeeId),
    'emp-del': () => VS.confirmDeleteEmployee(ui.employeeId),
    'emp-new-vac': () => VS.newVacation(ui.employeeId),
    'emp-pair-add': () => VS.pairModal(ui.employeeId),
    'emp-show-conf': () => {
      const c = derived.conflicts.find(x => x.ids.includes(ui.employeeId));
      if (c) VS.showOnTimeline(c.s, ui.employeeId);
    },
    'vac-edit': el => VS.openVacation(Number(el.dataset.id)),
    'vac-del': el => VS.deleteVacation(Number(el.dataset.id))
  });

  VS.views.employee = { render };
})();
