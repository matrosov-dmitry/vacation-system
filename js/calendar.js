// Производственный календарь: клик по дню — рабочий → праздник → предпраздничный → рабочий.
(function() {
  'use strict';

  const VS = window.VS;
  const { data, ui, esc } = VS;
  const YEARS = [VS.YEAR, VS.YEAR + 1];

  // Названия праздников РФ по дате (MM-DD); в CSV их нет
  const NAMES = {
    '01-01': 'Новогодние каникулы', '01-07': 'Рождество Христово', '02-23': 'День защитника Отечества',
    '03-08': 'Международный женский день', '05-01': 'Праздник Весны и Труда', '05-09': 'День Победы',
    '06-12': 'День России', '11-04': 'День народного единства', '12-31': 'Выходной 31 декабря'
  };

  // Праздники, сгруппированные в непрерывные периоды
  function holidayRuns(year) {
    const map = VS.holidayMap(year);
    const days = Object.keys(map).filter(d => map[d] === 'holiday').sort();
    const runs = [];
    days.forEach(d => {
      const last = runs[runs.length - 1];
      if (last && VS.addDays(last.e, 1) === d) last.e = d; else runs.push({ s: d, e: d });
    });
    return runs.map(r => {
      const key = Object.keys(NAMES).find(k => { const iso = `${year}-${k}`; return iso >= r.s && iso <= r.e; });
      return { ...r, name: key ? NAMES[key] : 'Праздничный день' };
    });
  }

  function render() {
    const year = ui.calYear;
    const today = VS.todayIso();
    let workDays = 0, offDays = 0;
    const months = VS.MONTHS.map((name, m) => {
      const first = VS.isoFromYMD(year, m, 1);
      const off = VS.weekdayMon(first);
      const dim = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      let cells = '', work = 0;
      for (let i = 0; i < off; i++) cells += '<div class="cal-d blank"></div>';
      for (let d = 1; d <= dim; d++) {
        const iso = VS.isoFromYMD(year, m, d);
        const t = VS.dayType(iso), we = VS.isWeekend(iso);
        if (t !== 'holiday' && !we) work++; else offDays++;
        const cls = t === 'holiday' ? 'hol' : t === 'preholiday' ? 'pre' : we ? 'we' : '';
        const title = t === 'holiday' ? 'Праздник' : t === 'preholiday' ? 'Предпраздничный (сокращённый)' : we ? 'Выходной' : 'Рабочий';
        cells += `<div class="cal-d ${cls} ${iso === today ? 'today' : ''}" data-act="cal-day" data-iso="${iso}" title="${VS.fmtNum(iso)} · ${title}">${d}</div>`;
      }
      workDays += work;
      return `<div class="card cal-month">
        <div class="top"><b>${name}</b><span>${work} раб.</span></div>
        <div class="cal-days">${VS.DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>
      </div>`;
    }).join('');

    const runs = holidayRuns(year).map(r => `<div class="row"><span>${esc(r.name)}</span><span>${VS.fmtRange(r.s, r.e)}</span></div>`).join('')
      || '<div class="row"><span class="faint">Праздники не заданы</span><span></span></div>';
    const edited = !!data.holidays[year];
    const hasBase = !!data.baseHolidays[year];

    return `<div class="page-split w340">
      <div class="page-main" style="padding:20px 28px;gap:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="h1">Производственный календарь</span>
          <div class="seg">${YEARS.map(y => `<button type="button" class="${y === year ? 'on' : ''}" data-act="cal-year" data-y="${y}">${y}</button>`).join('')}</div>
        </div>
        <div class="cal-grid">${months}</div>
      </div>
      <aside class="page-side" style="padding:20px;gap:16px">
        <div class="totals">
          <div class="kpi"><b>${workDays}</b><span>рабочих дней</span></div>
          <div class="kpi"><b>${offDays}</b><span>выходных и праздничных</span></div>
        </div>
        <div class="legend">
          <span><i style="background:var(--day-holiday);border:1px solid #e3b5aa"></i>Праздник</span>
          <span><i style="background:var(--day-pre);border:1px solid #dcc58f"></i>Предпраздничный</span>
          <span><i style="background:var(--day-weekend);border:1px solid var(--border)"></i>Выходной</span>
        </div>
        <div class="card hol-list"><div class="head">Праздники</div>${runs}</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.5">Праздники не входят в отпускные дни. Предпраздничные — только для информации. Клик по дню меняет его тип; изменения сразу пересчитывают отпуска.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-strong" data-act="csv" data-k="import-holidays">Импорт CSV</button>
          <button type="button" class="btn btn-strong" data-act="csv" data-k="export-holidays">Экспорт</button>
          ${edited ? `<button type="button" class="btn btn-strong" data-act="cal-reset" title="${hasBase ? 'Вернуть календарь из templates/holidays.csv' : 'Удалить все отметки года'}">Сбросить правки</button>` : ''}
        </div>
      </aside>
    </div>`;
  }

  Object.assign(VS.act, {
    'cal-year': el => { ui.calYear = Number(el.dataset.y); VS.render(); },
    'cal-day': el => {
      const iso = el.dataset.iso, t = VS.dayType(iso);
      VS.setDayType(iso, t === '' ? 'holiday' : t === 'holiday' ? 'preholiday' : '');
      VS.commit();
    },
    'cal-reset': () => {
      if (!confirm(`Сбросить правки календаря на ${ui.calYear} год?`)) return;
      delete data.holidays[ui.calYear];
      VS.commit('Календарь восстановлен');
    }
  });

  VS.views.calendar = { render };
})();
