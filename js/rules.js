// Правила: группы с лимитом, несовместимые пары, запретные периоды, проверки ТК, «Проверка плана».
(function() {
  'use strict';

  const VS = window.VS;
  const { data, derived, esc } = VS;

  const CHECKS = [
    ['min14', 'Одна часть отпуска — не менее 14 дней', 'ст. 125 ТК РФ, проверяется по году'],
    ['leftover', 'Неиспользованные дни на 1 декабря', 'Предупреждать, если остаток больше 0'],
    ['workdaysOnly', 'Выходные не считаются пересечением', 'Конфликт — только общие рабочие дни'],
    ['afterHolidays', 'Запрет отпуска сразу после праздников', 'Первая рабочая неделя января и мая']
  ];

  function render() {
    const groups = data.groups.map(g => {
      const members = g.memberIds.map(VS.empShort).join(', ') || 'нет участников';
      return `<div class="grp-row">
        <span class="name" data-act="grp-edit" data-id="${g.id}" title="Изменить группу">${esc(g.name)}</span>
        <span class="members" data-act="grp-edit" data-id="${g.id}" title="${esc(members)}">${esc(members)}</span>
        <div class="stepper-wrap">не больше
          <div class="stepper"><button type="button" data-act="grp-step" data-id="${g.id}" data-d="-1" aria-label="Меньше">−</button><span>${g.maxConcurrent}</span><button type="button" data-act="grp-step" data-id="${g.id}" data-d="1" aria-label="Больше">+</button></div>
        </div>
      </div>`;
    }).join('') || '<div class="card-pad"><div class="empty-note">Групп пока нет. Объедините сотрудников, которые не могут уходить в отпуск все сразу.</div></div>';

    const pairs = data.pairs.map(([a, b]) => `<span class="pair-chip">${esc(VS.empShort(a))} ↔ ${esc(VS.empShort(b))}<button type="button" class="btn-x" data-act="pair-del" data-a="${a}" data-b="${b}" title="Удалить пару">×</button></span>`).join('');

    const blackouts = [...data.blackouts].sort((a, b) => a.start < b.start ? -1 : 1).map(b => `<div class="list-row">
        <span>${esc(b.name)}</span>
        <span style="display:flex;align-items:center;gap:8px"><span class="mono muted">${VS.fmtShort(b.start)} – ${VS.fmtShort(b.end)}</span><button type="button" class="btn-x" data-act="bo-del" data-id="${b.id}" title="Удалить период">×</button></span>
      </div>`).join('') || '<div class="empty-note">Запретных периодов нет</div>';

    const checks = CHECKS.map(([k, t, d]) => `<div class="check-row">
        <div><span>${t}</span><span>${d}</span></div>
        <button type="button" class="toggle ${data.checks[k] ? 'on' : ''}" data-act="check" data-k="${k}" role="switch" aria-checked="${!!data.checks[k]}" aria-label="${esc(t)}"><span></span></button>
      </div>`).join('');

    const n = derived.issues.length;
    const issues = derived.issues.map(i => `<div class="issue"><span class="k">${esc(i.k)}</span><span class="t">${esc(i.t)}</span><span class="d">${esc(i.d)}</span></div>`).join('');

    return `<div class="page-split">
      <div class="page-main">
        <div class="h1">Правила планирования</div>
        <div class="card">
          <div class="card-head"><div><b>Группы</b><span>Сколько человек из группы могут отсутствовать одновременно</span></div><button type="button" class="btn-dashed" data-act="grp-add">+ Группа</button></div>
          ${groups}
        </div>
        <div class="two-col">
          <div class="card card-pad">
            <div class="card-head-inline"><b>Несовместимые пары</b><span>Точечные исключения вне групп</span></div>
            <div class="pair-chips">${pairs}<button type="button" class="btn-dashed" data-act="pair-add">+ Пара</button></div>
          </div>
          <div class="card card-pad">
            <div class="card-head-inline"><b>Запретные периоды</b><span>Отпуск в эти даты не планируется</span></div>
            ${blackouts}
            <button type="button" class="btn-dashed" data-act="bo-add">+ Период</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><b>Проверки</b></div></div>
          ${checks}
        </div>
      </div>
      <aside class="page-side">
        <div class="issues-head"><b>Проверка плана</b><span class="${n ? '' : 'ok'}">${n} ${VS.plural(n, ['нарушение', 'нарушения', 'нарушений'])}</span></div>
        <div style="font-size:12px;color:var(--text-2)">Пересчитывается при каждом изменении отпусков и правил</div>
        ${issues || '<div class="empty-note">Нарушений нет — план соответствует правилам.</div>'}
      </aside>
    </div>`;
  }

  // ================== МОДАЛКИ ==================
  function groupModal(id) {
    const g = id != null ? data.groups.find(x => x.id === id) : null;
    const list = data.employees.map(e => `<label><input type="checkbox" value="${e.id}" ${g && g.memberIds.includes(e.id) ? 'checked' : ''}> ${esc(e.name)}</label>`).join('')
      || '<div class="empty-note">Сначала добавьте сотрудников</div>';
    VS.openModal({
      title: g ? 'Группа' : 'Новая группа',
      body: `<form style="display:flex;flex-direction:column;gap:14px" novalidate>
        <div class="field"><span class="field-label">Название</span><input class="input" id="g-name" value="${g ? esc(g.name) : ''}" placeholder="Например, Аналитика"></div>
        <div class="field"><span class="field-label">Не больше одновременно</span><input class="input mono" id="g-max" type="number" min="1" value="${g ? g.maxConcurrent : 1}"></div>
        <div class="field"><span class="field-label">Участники</span><div class="checklist">${list}</div></div>
        <div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg">Сохранить</button>${g ? '<button type="button" class="btn btn-danger-text btn-lg" id="g-del">Удалить</button>' : ''}<button type="button" class="btn btn-strong btn-lg" data-modal-close>Отмена</button></div>
      </form>`,
      onMount: m => {
        const del = m.querySelector('#g-del');
        if (del) del.addEventListener('click', () => {
          if (!confirm(`Удалить группу «${g.name}»?`)) return;
          data.groups = data.groups.filter(x => x.id !== g.id);
          VS.closeModal(); VS.commit('Группа удалена');
        });
        m.querySelector('form').addEventListener('submit', ev => {
          ev.preventDefault();
          const name = m.querySelector('#g-name').value.trim();
          const max = Number(m.querySelector('#g-max').value);
          if (!name || /<|>/.test(name)) { VS.toast('Укажите название группы', true); return; }
          if (!Number.isInteger(max) || max < 1) { VS.toast('Лимит — целое число от 1', true); return; }
          const memberIds = [...m.querySelectorAll('.checklist input:checked')].map(i => Number(i.value));
          if (g) Object.assign(g, { name, maxConcurrent: max, memberIds });
          else data.groups.push({ id: VS.newId(), name, maxConcurrent: max, memberIds });
          VS.closeModal(); VS.commit(g ? 'Группа обновлена' : 'Группа добавлена');
        });
      }
    });
  }

  function blackoutModal() {
    const y = VS.YEAR;
    VS.openModal({
      title: 'Запретный период',
      body: `<form style="display:flex;flex-direction:column;gap:14px" novalidate>
        <div class="field"><span class="field-label">Название</span><input class="input" id="b-name" placeholder="Например, Закрытие года"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="field"><span class="field-label">С</span><input class="input mono" id="b-from" placeholder="ДД.ММ.ГГГГ" value="01.12.${y}"></div>
          <div class="field"><span class="field-label">По</span><input class="input mono" id="b-to" placeholder="ДД.ММ.ГГГГ" value="31.12.${y}"></div>
        </div>
        <div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg">Добавить период</button><button type="button" class="btn btn-strong btn-lg" data-modal-close>Отмена</button></div>
      </form>`,
      onMount: m => m.querySelector('form').addEventListener('submit', ev => {
        ev.preventDefault();
        const name = m.querySelector('#b-name').value.trim();
        const s = VS.parseHuman(m.querySelector('#b-from').value), e = VS.parseHuman(m.querySelector('#b-to').value);
        if (!name || /<|>/.test(name)) { VS.toast('Укажите название периода', true); return; }
        if (!s || !e) { VS.toast('Даты в формате ДД.ММ.ГГГГ', true); return; }
        if (e < s) { VS.toast('Дата начала позже даты окончания', true); return; }
        data.blackouts.push({ id: VS.newId(), name, start: s, end: e });
        VS.closeModal(); VS.commit('Запретный период добавлен');
      })
    });
  }

  Object.assign(VS.act, {
    'grp-add': () => groupModal(null),
    'grp-edit': el => groupModal(Number(el.dataset.id)),
    'grp-step': el => {
      const g = data.groups.find(x => x.id === Number(el.dataset.id));
      if (!g) return;
      const max = Math.max(1, g.memberIds.length);
      g.maxConcurrent = Math.max(1, Math.min(max, g.maxConcurrent + Number(el.dataset.d)));
      VS.commit();
    },
    'bo-add': () => blackoutModal(),
    'bo-del': el => { data.blackouts = data.blackouts.filter(b => b.id !== Number(el.dataset.id)); VS.commit('Период удалён'); },
    'check': el => { const k = el.dataset.k; data.checks[k] = !data.checks[k]; VS.commit(); }
  });

  VS.views.rules = { render };
})();
