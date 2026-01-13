(function() {
  'use strict';

  // ================== КОНСТАНТЫ И СОСТОЯНИЕ ==================
  const YEAR = 2026;
  const EMPLOYEES_KEY = 'employees';
  const VACATIONS_KEY = 'vacations';
  const CONFLICT_GROUPS_KEY = 'conflictGroups';

  const STATUSES = ['Запланирован', 'Использован', 'Отменен', 'Перенесен'];

  // Праздничные дни 2026
  const HOLIDAYS_2026 = [
    // новогодние каникулы
    '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09','2026-01-10','2026-01-11',
    // 23 февраля
    '2026-02-23',
    // 8 марта
    '2026-03-08',
    // 1 мая
    '2026-05-01',
    // 9 мая
    '2026-05-09',
    // 12 июня
    '2026-06-12',
    // 4 ноября
    '2026-11-04',
    // 31 декабря
    '2026-12-31'
  ];

  // Предпраздничные дни 2026
  const PRE_HOLIDAYS_2026 = [
    '2026-04-30',
    '2026-05-08',
    '2026-06-11',
    '2026-11-03'
  ];

  const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  const state = {
    employees: [],
    vacations: [],
    conflictGroups: [],
    conflicts: [],
    conflictVacationIds: new Set(),
    calendar: {
      year: YEAR,
      // при старте показываем текущий месяц
      month: new Date().getFullYear() === YEAR ? new Date().getMonth() : 0,
      view: 'month',
      filters: {
        employeeIds: new Set(),
        statuses: new Set(STATUSES)
      },
      upcomingCollapsed: false
    }
  };

  // ================== УТИЛИТЫ ==================
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function showToast(message) {
    const el = $('#toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  function parseISO(str) {
    if (!str) return null;
    const [y,m,d] = str.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m-1, d);
  }
  function formatISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function formatHuman(iso) {
    if (!iso) return '';
    const [y,m,d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  function compareISO(a,b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  function isWeekendISO(iso) {
    const dt = parseISO(iso);
    const day = dt.getDay(); // 0=вс,6=сб
    return day === 0 || day === 6;
  }
  function isHolidayISO(iso) {
    return HOLIDAYS_2026.includes(iso);
  }
  function isPreHolidayISO(iso) {
    return PRE_HOLIDAYS_2026.includes(iso);
  }

  function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function weekdayMondayIndex(date) {
    // Возвращает индекс дня недели с началом в понедельник: Пн=0 ... Вс=6
    const jsDay = date.getDay(); // 0=Вс ... 6=Сб
    return (jsDay + 6) % 7;
  }

  function clampMonthView(year, monthIndex) {
    // В проекте год фиксированный (YEAR). Не даём уйти за границы.
    if (year < YEAR) return { year: YEAR, monthIndex: 0 };
    if (year > YEAR) return { year: YEAR, monthIndex: 11 };
    if (monthIndex < 0) return { year: YEAR, monthIndex: 0 };
    if (monthIndex > 11) return { year: YEAR, monthIndex: 11 };
    return { year, monthIndex };
  }

  function isIsoInYear(iso, year) {
    return Boolean(iso) && iso.startsWith(String(year) + '-');
  }

  function getQuarterByMonthIndex(m) {
    if (m <= 2) return 1;
    if (m <= 5) return 2;
    if (m <= 8) return 3;
    return 4;
  }

  // Расчёт отпускных дней с учётом праздников (выходные считаются отпускными)
  function calcVacationMetrics(startIso, endIso) {
    const start = parseISO(startIso);
    const end = parseISO(endIso);
    if (!start || !end || end < start) return null;

    let current = new Date(start);
    let calendarDays = 0;
    let holidayDays = 0;

    while (current <= end) {
      const iso = formatISO(current);
      calendarDays++;
      if (isHolidayISO(iso)) {
        holidayDays++;
      }
      current.setDate(current.getDate()+1);
    }
    const vacationDays = calendarDays - holidayDays;
    return {
      calendarDays,
      holidayDays,
      vacationDays,
      workingDays: vacationDays
    };
  }

  function isWorkingDayISO(iso) {
    // для конфликтов учитываем только дни, которые не являются выходными
    return !isWeekendISO(iso);
  }

  // Пересекаются ли отпуска по рабочим дням (игнорируем выходные)
  function overlapOnWorkingDays(start1Iso, end1Iso, start2Iso, end2Iso) {
    const s1 = parseISO(start1Iso);
    const e1 = parseISO(end1Iso);
    const s2 = parseISO(start2Iso);
    const e2 = parseISO(end2Iso);
    if (!s1 || !s2 || !e1 || !e2) return false;

    const start = s1 > s2 ? s1 : s2;
    const end = e1 < e2 ? e1 : e2;
    if (end < start) return false;

    const cur = new Date(start);
    while (cur <= end) {
      const iso = formatISO(cur);
      if (isWorkingDayISO(iso)) return true;
      cur.setDate(cur.getDate()+1);
    }
    return false;
  }

  function quarterRange(q) {
    const startMonth = (q-1)*3;
    const start = new Date(YEAR, startMonth, 1);
    const end = new Date(YEAR, startMonth+3, 0);
    return {start, end};
  }

  // ================== ХРАНИЛИЩЕ ==================
  function loadState() {
    try {
      const empRaw = localStorage.getItem(EMPLOYEES_KEY);
      const vacRaw = localStorage.getItem(VACATIONS_KEY);
      const confRaw = localStorage.getItem(CONFLICT_GROUPS_KEY);

      state.employees = empRaw ? JSON.parse(empRaw) : [];
      state.vacations = vacRaw ? JSON.parse(vacRaw) : [];
      state.conflictGroups = confRaw ? JSON.parse(confRaw) : [];

      if (!state.employees.length) {
        state.employees = [];
      }
    } catch (e) {
      console.error('Ошибка чтения localStorage', e);
      state.employees = [];
      state.vacations = [];
      state.conflictGroups = [];
    }
    recalcUsedDays();
    recalcConflicts();
  }

  function saveState() {
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(state.employees));
    localStorage.setItem(VACATIONS_KEY, JSON.stringify(state.vacations));
    localStorage.setItem(CONFLICT_GROUPS_KEY, JSON.stringify(state.conflictGroups));
  }

  function clearStorageAndReset() {
    localStorage.removeItem(EMPLOYEES_KEY);
    localStorage.removeItem(VACATIONS_KEY);
    localStorage.removeItem(CONFLICT_GROUPS_KEY);
    state.employees = [];
    state.vacations = [];
    state.conflictGroups = [];
    state.conflicts = [];
    state.conflictVacationIds = new Set();
    recalcUsedDays();
    recalcConflicts();
    renderAll();
    saveState();
    showToast('Данные очищены');
  }

  // ================== ПЕРЕСЧЁТ И КОНФЛИКТЫ ==================
  function recalcUsedDays() {
    const map = new Map();
    state.employees.forEach(e => map.set(e.id, 0));
    for (const v of state.vacations) {
      if (v.status !== 'Использован') continue;
      if (!map.has(v.employeeId)) continue;
      map.set(v.employeeId, map.get(v.employeeId) + (v.workingDays || v.days || 0));
    }
    state.employees.forEach(e => {
      e.usedVacationDays = map.get(e.id) || 0;
    });
  }

  function areEmployeesInConflictGroup(id1, id2) {
    if (id1 === id2) return false;
    for (const g of state.conflictGroups) {
      if ((g.employee1Id === id1 && g.employee2Id === id2) ||
          (g.employee1Id === id2 && g.employee2Id === id1)) return true;
    }
    return false;
  }

  function recalcConflicts() {
    const conflicts = [];
    const conflictIds = new Set();

    const planned = state.vacations.filter(v => v.status === 'Запланирован');
    for (let i=0; i<planned.length; i++) {
      for (let j=i+1; j<planned.length; j++) {
        const v1 = planned[i];
        const v2 = planned[j];
        if (!areEmployeesInConflictGroup(v1.employeeId, v2.employeeId)) continue;
        if (!overlapOnWorkingDays(v1.start, v1.end, v2.start, v2.end)) continue;

        const s = parseISO(v1.start) > parseISO(v2.start) ? v1.start : v2.start;
        const e = parseISO(v1.end) < parseISO(v2.end) ? v1.end : v2.end;
        conflicts.push({
          employee1: v1.name,
          employee2: v2.name,
          overlapStart: s,
          overlapEnd: e,
          vacation1: v1,
          vacation2: v2
        });
        conflictIds.add(v1.id);
        conflictIds.add(v2.id);
      }
    }
    state.conflicts = conflicts;
    state.conflictVacationIds = conflictIds;
  }

  function commitAndRender(message) {
    recalcUsedDays();
    recalcConflicts();
    saveState();
    renderAll();
    if (message) showToast(message);
  }

  // ================== ОТРИСОВКА ВСЕГО ==================
  function renderAll() {
    renderHeaderShortStats();
    renderEmployeesSection();
    renderVacationsSection();
    renderConflictsSection();
    renderReportsSection();
    renderCalendarSection();
  }

  // ================== ШАПКА ==================
  function renderHeaderShortStats() {
    const el = $('#header-short-stats');
    if (!el) return;
    const totalEmp = state.employees.length;
    const totalVac = state.vacations.length;
    const totalUsed = state.employees.reduce((sum,e)=>sum+(e.usedVacationDays||0),0);
    const plannedCount = state.vacations.filter(v=>v.status==='Запланирован').length;

    el.innerHTML = '';
    const pills = [
      {label:'Сотрудников', value: totalEmp},
      {label:'Отпусков', value: totalVac},
      {label:'Исп. дней', value: totalUsed},
      {label:'Запланировано', value: plannedCount}
    ];
    for (const p of pills) {
      const span = document.createElement('span');
      span.className = 'short-pill';
      span.innerHTML = `<strong>${p.value}</strong> ${p.label}`;
      el.appendChild(span);
    }
  }

  // ================== ВКЛАДКИ И ТЕМА ==================
  function initTabsAndTheme() {
    const tabs = $$('.tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const key = tab.dataset.tab;
        tabs.forEach(t=>t.classList.toggle('tab-active', t===tab));
        $$('.tab-panel').forEach(sec => {
          sec.classList.toggle('tab-panel-active', sec.id === 'tab-'+key);
        });
      });
    });
  }

  // ================== СОТРУДНИКИ ==================
  function renderEmployeesSection() {
    renderEmployeesTable();
    fillEmployeeSelects();
  }

  function renderEmployeesTable() {
    const body = $('#emp-table-body');
    if (!body) return;
    body.innerHTML = '';
    for (const emp of state.employees) {
      const tr = document.createElement('tr');
      const left = emp.totalVacationDays - emp.usedVacationDays;
      const pct = emp.totalVacationDays ? Math.round(emp.usedVacationDays/emp.totalVacationDays*100) : 0;
      tr.innerHTML = `
        <td>${emp.name}</td>
        <td>${emp.totalVacationDays}</td>
        <td>${emp.usedVacationDays}</td>
        <td>${left}</td>
        <td>${pct}%</td>
        <td>
          <button type="button" class="btn btn-ghost btn-xs" data-action="edit" data-id="${emp.id}">Изм.</button>
          <button type="button" class="btn btn-ghost btn-xs" data-action="delete" data-id="${emp.id}">Удалить</button>
        </td>
      `;
      body.appendChild(tr);
    }
  }

  function fillEmployeeSelects() {
    const selects = ['#vac-emp','#conf-emp1','#conf-emp2'];
    for (const sel of selects) {
      const el = $(sel);
      if (!el) continue;
      const current = el.value;
      el.innerHTML = '<option value="">Не выбрано</option>' + state.employees.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
      if (current && state.employees.some(e=>String(e.id)===current)) el.value = current;
    }
    renderCalendarFiltersEmployees();
  }

  function initEmployeesHandlers() {
    const form = $('#emp-form');
    const cancel = $('#emp-cancel');

    cancel.addEventListener('click', () => {
      form.reset();
      $('#emp-id').value = '';
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const idVal = $('#emp-id').value.trim();
      const name = $('#emp-name').value.trim();
      const total = Number($('#emp-total').value);
      if (!name) { showToast('Введите ФИО'); return; }
      if (!total || total <=0) { showToast('Укажите количество дней'); return; }

      if (idVal) {
        const emp = state.employees.find(e=>String(e.id)===idVal);
        if (emp) {
          emp.name = name;
          emp.totalVacationDays = total;
          // обновим имя во всех отпусках и группах
          state.vacations.forEach(v=>{ if (v.employeeId===emp.id) v.name = name; });
          state.conflictGroups.forEach(g=>{
            if (g.employee1Id===emp.id) g.employee1Name = name;
            if (g.employee2Id===emp.id) g.employee2Name = name;
          });
          commitAndRender('Сотрудник обновлён');
        }
      } else {
        const id = Date.now();
        state.employees.push({
          id,
          name,
          totalVacationDays: total,
          usedVacationDays: 0
        });
        commitAndRender('Сотрудник добавлен');
        $('#emp-id').value = '';
        form.reset();
      }
    });

    $('#emp-table-body').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const action = btn.dataset.action;
      const emp = state.employees.find(e=>e.id===id);
      if (!emp) return;

      if (action === 'edit') {
        $('#emp-id').value = emp.id;
        $('#emp-name').value = emp.name;
        $('#emp-total').value = emp.totalVacationDays;
        showToast('Редактирование сотрудника');
      } else if (action === 'delete') {
        if (!confirm('Удалить сотрудника и все его отпуска?')) return;
        state.employees = state.employees.filter(e=>e.id!==id);
        state.vacations = state.vacations.filter(v=>v.employeeId!==id);
        state.conflictGroups = state.conflictGroups.filter(g=>g.employee1Id!==id && g.employee2Id!==id);
        commitAndRender('Сотрудник удалён');
      }
    });
  }

  // ================== ОТПУСКА ==================
  function renderVacationsSection() {
    renderVacationEmployeeInfo();
    renderVacationsTable();
  }

  function currentEmployeeFromVacForm() {
    const empId = Number($('#vac-emp').value);
    if (!empId) return null;
    return state.employees.find(e=>e.id===empId) || null;
  }

  function renderVacationEmployeeInfo() {
    const info = $('#vac-emp-info');
    const emp = currentEmployeeFromVacForm();
    if (!info) return;
    if (!emp) {
      info.textContent = 'Выберите сотрудника, чтобы увидеть баланс отпускных дней.';
      return;
    }
    const left = emp.totalVacationDays - emp.usedVacationDays;
    info.textContent = `Всего: ${emp.totalVacationDays} дн · Использовано: ${emp.usedVacationDays} дн · Осталось: ${left} дн.`;
  }

  function vacationsFilteredForTable() {
    const qStatus = $('#vac-filter-status').value;
    const qEmp = $('#vac-filter-emp').value.trim().toLowerCase();
    const qQuarter = $('#vac-filter-quarter').value;

    return state.vacations.filter(v => {
      if (qStatus && v.status !== qStatus) return false;
      if (qEmp && !v.name.toLowerCase().includes(qEmp)) return false;
      if (qQuarter) {
        const m = parseISO(v.start).getMonth();
        if (String(getQuarterByMonthIndex(m)) !== qQuarter) return false;
      }
      return true;
    });
  }

  function renderVacationsTable() {
    const body = $('#vac-table-body');
    body.innerHTML = '';
    const rows = vacationsFilteredForTable().sort((a,b)=>compareISO(a.start,b.start));
    for (const v of rows) {
      const tr = document.createElement('tr');
      if (state.conflictVacationIds.has(v.id)) tr.classList.add('conflict-row');
      tr.innerHTML = `
        <td>${v.name}</td>
        <td>${formatHuman(v.start)}</td>
        <td>${formatHuman(v.end)}</td>
        <td>${v.workingDays || v.days}</td>
        <td>${v.status}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-xs" data-action="edit" data-id="${v.id}">Изм.</button>
          <button type="button" class="btn btn-ghost btn-xs" data-action="delete" data-id="${v.id}">Удалить</button>
        </td>
      `;
      body.appendChild(tr);
    }
  }

  // ================== DATE RANGE PICKER (Отпуска) ==================
  function initVacationRangePicker() {
    const rangeInput = $('#vac-range');
    const popover = $('#vac-range-popover');
    const grid = $('#vac-range-grid');
    const monthLabel = $('#vac-range-month');
    const btnPrev = $('#vac-range-prev');
    const btnNext = $('#vac-range-next');
    const wrap = $('#vac-range-wrap');
    const startField = $('#vac-start');
    const endField = $('#vac-end');

    if (!rangeInput || !popover || !grid || !monthLabel || !btnPrev || !btnNext || !wrap || !startField || !endField) {
      return;
    }

    const picker = {
      viewYear: YEAR,
      viewMonth: 0,
      anchorIso: null,
      hoverIso: null
    };


    function setRangeDisplayFromIso() {
      const s = startField.value;
      const e = endField.value;
      if (!s && !e) {
        rangeInput.value = '';
        return;
      }
      if (s && !e) {
        rangeInput.value = formatHuman(s);
        return;
      }
      if (!s && e) {
        rangeInput.value = formatHuman(e);
        return;
      }
      rangeInput.value = `${formatHuman(s)} – ${formatHuman(e)}`;
    }

    function applyRangeToFields(startIso, endIso, { close = false } = {}) {
      startField.value = startIso || '';
      endField.value = endIso || '';
      setRangeDisplayFromIso();
      updateVacationMetricsPreview();
      if (close) closePopover();
    }

    function openPopover() {
      popover.classList.remove('hidden');
      // Если уже есть start, открываем месяц start. Если нет — текущий месяц календаря приложения или январь.
      const startIso = startField.value;
      if (startIso && isIsoInYear(startIso, YEAR)) {
        const dt = parseISO(startIso);
        picker.viewYear = dt.getFullYear();
        picker.viewMonth = dt.getMonth();
      } else {
        const now = new Date();
        picker.viewYear = YEAR;
        picker.viewMonth = (now.getFullYear() === YEAR) ? now.getMonth() : 0;
      }
      render();
    }

    function closePopover() {
      popover.classList.add('hidden');
      picker.anchorIso = null;
      picker.hoverIso = null;
    }

    function isOpen() {
      return !popover.classList.contains('hidden');
    }

    function inRange(iso, a, b) {
      if (!iso || !a || !b) return false;
      const min = compareISO(a, b) <= 0 ? a : b;
      const max = compareISO(a, b) <= 0 ? b : a;
      return iso >= min && iso <= max;
    }

    function render() {
      const { year, monthIndex } = clampMonthView(picker.viewYear, picker.viewMonth);
      picker.viewYear = year;
      picker.viewMonth = monthIndex;

      monthLabel.textContent = `${MONTH_NAMES[monthIndex]} ${year}`;

      const first = new Date(year, monthIndex, 1);
      const startOffset = weekdayMondayIndex(first);
      const dim = getDaysInMonth(year, monthIndex);

      const startIso = startField.value || null;
      const endIso = endField.value || null;
      const anchor = picker.anchorIso || (startIso && !endIso ? startIso : null);
      const hover = picker.hoverIso;

      grid.innerHTML = '';

      // 6 недель * 7 дней = 42 ячейки
      for (let i = 0; i < 42; i++) {
        const dayNum = i - startOffset + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'date-range-day';

        if (dayNum < 1 || dayNum > dim) {
          btn.disabled = true;
          btn.textContent = '';
          grid.appendChild(btn);
          continue;
        }

        btn.textContent = String(dayNum);
        const iso = formatISO(new Date(year, monthIndex, dayNum));
        btn.dataset.iso = iso;

        // Ограничение годом
        if (!isIsoInYear(iso, YEAR)) {
          btn.disabled = true;
          grid.appendChild(btn);
          continue;
        }

        // Подсветка
        if (startIso && iso === startIso) btn.classList.add('is-start');
        if (endIso && iso === endIso) btn.classList.add('is-end');
        if (startIso && endIso && inRange(iso, startIso, endIso)) btn.classList.add('is-in-range');

        if (anchor && !endIso && hover && inRange(iso, anchor, hover)) {
          btn.classList.add('is-hover-range');
        }

        btn.addEventListener('mouseenter', () => {
          const s = startField.value;
          const e = endField.value;
          if (s && !e) {
            picker.anchorIso = s;
            picker.hoverIso = iso;
            render();
          }
        });

        grid.appendChild(btn);
      }

      // Навигация по месяцам (только в пределах YEAR)
      btnPrev.disabled = (picker.viewYear === YEAR && picker.viewMonth === 0);
      btnNext.disabled = (picker.viewYear === YEAR && picker.viewMonth === 11);
    }

    btnPrev.addEventListener('click', () => {
      picker.viewMonth -= 1;
      render();
    });

    btnNext.addEventListener('click', () => {
      picker.viewMonth += 1;
      render();
    });

    // ВАЖНО: клики внутри popover не должны считаться «кликом снаружи»
    // иначе второй клик (end) может не отработать.
    popover.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    rangeInput.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen()) {
        closePopover();
      } else {
        openPopover();
      }
    });

    rangeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePopover();
        rangeInput.blur();
      }
      if (e.key === 'Enter' && !isOpen()) {
        e.preventDefault();
        openPopover();
      }
    });

    // Закрытие по клику снаружи.
    // Используем pointerdown + capture, чтобы не зависеть от stopPropagation внутри,
    // и чтобы второй клик по дню точно успевал отработать.
    document.addEventListener('pointerdown', (e) => {
      if (!isOpen()) return;
      if (wrap.contains(e.target)) return;
      closePopover();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') closePopover();
    });

    // Делегированный обработчик: ставим один раз, потому что кнопки дней пересоздаются в render().
    grid.onpointerup = (e) => {
      const btn = e.target.closest('button.date-range-day');
      if (!btn || btn.disabled) return;
      const iso = btn.dataset.iso;
      if (!iso) return;

      const currentStart = startField.value || null;
      const currentEnd = endField.value || null;

      // 1-й клик (или новый выбор после полного диапазона)
      if (!currentStart || currentEnd) {
        picker.anchorIso = iso;
        picker.hoverIso = null;
        applyRangeToFields(iso, '', { close: false });
        render();
        return;
      }

      // 2-й клик -> end
      let s = currentStart;
      let end = iso;
      if (compareISO(end, s) < 0) {
        const tmp = s; s = end; end = tmp;
      }
      picker.anchorIso = null;
      picker.hoverIso = null;
      applyRangeToFields(s, end, { close: true });
    };

    // Публичная синхронизация: когда значения ISO меняются из других мест (edit/quick/reset)
    window.__syncVacationRangePicker = () => {
      setRangeDisplayFromIso();
      if (isOpen()) render();
    };

    // Инициализация отображения
    setRangeDisplayFromIso();
    }

  // ================== ОТПУСКА ==================
  function initVacationsHandlers() {
    const form = $('#vac-form');
    const empSelect = $('#vac-emp');

    empSelect.addEventListener('change', () => {
      renderVacationEmployeeInfo();
    });

    // ISO-поля скрытые, но продолжаем слушать изменения (на случай ручной установки значения из кода)
    $('#vac-start').addEventListener('change', () => {
      updateVacationMetricsPreview();
      if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
    });
    $('#vac-end').addEventListener('change', () => {
      updateVacationMetricsPreview();
      if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
    });

    // Инициализируем range picker
    initVacationRangePicker();

    $$('#vac-form [data-quick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = Number(btn.dataset.quick);
        const startVal = $('#vac-start').value;
        if (!startVal) {
          showToast('Сначала выберите дату начала');
          return;
        }
        const start = parseISO(startVal);
        const end = new Date(start);
        end.setDate(end.getDate() + days - 1);
        $('#vac-end').value = formatISO(end);
        updateVacationMetricsPreview();
        if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
      });
    });

    $('#vac-reset').addEventListener('click', () => {
      form.reset();
      $('#vac-id').value = '';
      renderVacationEmployeeInfo();
      $('#vac-days-info').textContent = 'Отпускные дни будут посчитаны после выбора дат.';
      if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const idVal = $('#vac-id').value.trim();
      const empId = Number($('#vac-emp').value);
      const emp = state.employees.find(e=>e.id===empId);
      if (!emp) { showToast('Выберите сотрудника'); return; }
      const startIso = $('#vac-start').value;
      const endIso = $('#vac-end').value;
      if (!startIso || !endIso) { showToast('Укажите даты начала и окончания'); return; }
      const metrics = calcVacationMetrics(startIso, endIso);
      if (!metrics) { showToast('Неверный диапазон дат'); return; }

      const status = $('#vac-status').value || 'Запланирован';

      // Проверка лимита дней для сотрудника с учётом всех отпусков кроме редактируемого
      const existing = state.vacations.filter(v => v.employeeId === emp.id && v.id !== (idVal ? Number(idVal) : -1) && v.status !== 'Отменен');
      const usedOther = existing.reduce((sum,v)=>sum+(v.workingDays||v.days||0),0);
      const totalAfter = usedOther + metrics.vacationDays;
      if (totalAfter > emp.totalVacationDays) {
        showToast(`Недостаточно дней. После добавления будет ${totalAfter} из ${emp.totalVacationDays}.`);
        return;
      }

      if (idVal) {
        const id = Number(idVal);
        const v = state.vacations.find(x=>x.id===id);
        if (v) {
          v.employeeId = emp.id;
          v.name = emp.name;
          v.start = startIso;
          v.end = endIso;
          v.days = metrics.vacationDays;
          v.workingDays = metrics.workingDays;
          v.status = status;
        }
        commitAndRender('Отпуск обновлён');
      } else {
        const id = Date.now();
        state.vacations.push({
          id,
          employeeId: emp.id,
          name: emp.name,
          start: startIso,
          end: endIso,
          days: metrics.vacationDays,
          workingDays: metrics.workingDays,
          status
        });
        commitAndRender('Отпуск создан');
      }
      $('#vac-id').value = '';
      form.reset();
      renderVacationEmployeeInfo();
      $('#vac-days-info').textContent = 'Отпускные дни будут посчитаны после выбора дат.';
    });

    $('#vac-table-body').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const v = state.vacations.find(x=>x.id===id);
      if (!v) return;
      if (btn.dataset.action === 'edit') {
        $('#vac-id').value = v.id;
        $('#vac-emp').value = String(v.employeeId);
        $('#vac-start').value = v.start;
        $('#vac-end').value = v.end;
        $('#vac-status').value = v.status;
        renderVacationEmployeeInfo();
        updateVacationMetricsPreview();
        if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
        showToast('Редактирование отпуска');
      } else if (btn.dataset.action === 'delete') {
        if (!confirm('Удалить отпуск?')) return;
        state.vacations = state.vacations.filter(x=>x.id!==id);
        commitAndRender('Отпуск удалён');
      }
    });

    $('#vac-filter-status').addEventListener('change', renderVacationsTable);
    $('#vac-filter-emp').addEventListener('input', renderVacationsTable);
    $('#vac-filter-quarter').addEventListener('change', renderVacationsTable);
  }

  function updateVacationMetricsPreview() {
    const startIso = $('#vac-start').value;
    const endIso = $('#vac-end').value;
    const info = $('#vac-days-info');
    if (!startIso || !endIso) {
      info.textContent = 'Отпускные дни будут посчитаны после выбора дат.';
      return;
    }
    const m = calcVacationMetrics(startIso, endIso);
    if (!m) { info.textContent = 'Некорректный диапазон дат'; return; }
    info.textContent = `Отпускных дней: ${m.vacationDays} (из ${m.calendarDays} календарных, исключено праздников: ${m.holidayDays}).`;
  }

  // ================== КОНФЛИКТЫ ==================
  function renderConflictsSection() {
    renderConflictGroups();
    renderConflictsTable();
  }

  function renderConflictGroups() {
    const list = $('#conf-group-list');
    list.innerHTML = '';
    for (const g of state.conflictGroups) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${g.employee1Name} — ${g.employee2Name}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-id="${g.id}">Удалить</button>`;
      list.appendChild(li);
    }
  }

  function renderConflictsTable() {
    const body = $('#conf-table-body');
    body.innerHTML = '';
    for (const c of state.conflicts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.employee1}</td>
        <td>${c.employee2}</td>
        <td>${formatHuman(c.overlapStart)} – ${formatHuman(c.overlapEnd)}</td>
        <td>${formatHuman(c.vacation1.start)} – ${formatHuman(c.vacation1.end)} (${c.vacation1.status})</td>
        <td>${formatHuman(c.vacation2.start)} – ${formatHuman(c.vacation2.end)} (${c.vacation2.status})</td>
      `;
      body.appendChild(tr);
    }
  }

  function initConflictsHandlers() {
    const form = $('#conf-group-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id1 = Number($('#conf-emp1').value);
      const id2 = Number($('#conf-emp2').value);
      if (!id1 || !id2) { showToast('Выберите обоих сотрудников'); return; }
      if (id1 === id2) { showToast('Нужно выбрать разных сотрудников'); return; }
      if (areEmployeesInConflictGroup(id1,id2)) {
        showToast('Такая пара уже есть');
        return;
      }
      const e1 = state.employees.find(e=>e.id===id1);
      const e2 = state.employees.find(e=>e.id===id2);
      state.conflictGroups.push({
        id: Date.now(),
        employee1Id: id1,
        employee2Id: id2,
        employee1Name: e1.name,
        employee2Name: e2.name
      });
      commitAndRender('Группа пересечений добавлена');
    });

    $('#conf-group-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (!confirm('Удалить группу пересечений?')) return;
      state.conflictGroups = state.conflictGroups.filter(g=>g.id!==id);
      commitAndRender('Группа пересечений удалена');
    });

    $('#conf-recalc-btn').addEventListener('click', () => {
      recalcConflicts();
      renderConflictsSection();
      renderVacationsTable();
      renderCalendarSection();
      showToast('Конфликты пересчитаны');
    });
  }

  // ================== ОТЧЁТЫ ==================
  function renderReportsSection() {
    renderReportsEmployees();
    renderReportsOverall();
    renderReportsByMonth();
    renderReportsByQuarter();
  }

  function renderReportsEmployees() {
    const body = $('#rep-emp-body');
    body.innerHTML = '';
    for (const e of state.employees) {
      const plannedDays = state.vacations
        .filter(v => v.employeeId === e.id && v.status === 'Запланирован')
        .reduce((s, v) => s + (v.workingDays || v.days || 0), 0);

      const left = e.totalVacationDays - e.usedVacationDays;
      const pct = e.totalVacationDays ? Math.round(e.usedVacationDays/e.totalVacationDays*100) : 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${e.name}</td>
        <td>${e.totalVacationDays}</td>
        <td>${plannedDays}</td>
        <td>${e.usedVacationDays}</td>
        <td>${left}</td>
        <td>${pct}%</td>
      `;
      body.appendChild(tr);
    }
  }

  function renderReportsOverall() {
    const el = $('#rep-overall');
    const totalEmp = state.employees.length;
    const totalVac = state.vacations.length;
    const totalUsed = state.employees.reduce((sum,e)=>sum+e.usedVacationDays,0);
    const totalTotal = state.employees.reduce((sum,e)=>sum+e.totalVacationDays,0);
    const avgVacLength = totalVac ? (state.vacations.reduce((s,v)=>s+(v.workingDays||v.days||0),0) / totalVac) : 0;
    const avgUsage = totalTotal ? Math.round(totalUsed/totalTotal*100) : 0;
    const planned = state.vacations.filter(v=>v.status==='Запланирован').length;
    const plannedDays = state.vacations
      .filter(v => v.status === 'Запланирован')
      .reduce((s, v) => s + (v.workingDays || v.days || 0), 0);
    const conflictsCount = state.conflicts.length;

    const cells = [
      {t:'Сотрудников', v: totalEmp},
      {t:'Отпусков всего', v: totalVac},
      {t:'Использовано дней', v: totalUsed},
      {t:'Запланировано дней', v: plannedDays},
      {t:'Средняя длительность отпуска', v: avgVacLength ? avgVacLength.toFixed(1)+' дн' : '—'},
      {t:'Средний % использования', v: avgUsage+'%'},
      {t:'Запланированных отпусков', v: planned},
      {t:'Конфликтов', v: conflictsCount}
    ];
    el.innerHTML = '';
    for (const c of cells) {
      const div = document.createElement('div');
      div.className = 'stats-cell';
      div.innerHTML = `<div class="stats-cell-title">${c.t}</div><div class="stats-cell-value">${c.v}</div>`;
      el.appendChild(div);
    }
  }

  function renderReportsByMonth() {
    const body = $('#rep-month-body');
    body.innerHTML = '';
    for (let m=0;m<12;m++) {
      const monthVacs = state.vacations.filter(v=>parseISO(v.start).getMonth()===m);
      const count = monthVacs.length;
      const daysSum = monthVacs.reduce((s,v)=>s+(v.workingDays||v.days||0),0);
      const uniqueEmp = new Set(monthVacs.map(v=>v.employeeId)).size;
      const occupancy = state.employees.length ? Math.round(uniqueEmp/state.employees.length*100) : 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${MONTH_NAMES[m]}</td>
        <td>${count}</td>
        <td>${daysSum}</td>
        <td>${uniqueEmp}</td>
        <td>${occupancy}%</td>
      `;
      body.appendChild(tr);
    }
  }

  function renderReportsByQuarter() {
    const body = $('#rep-quarter-body');
    body.innerHTML = '';
    for (let q=1;q<=4;q++) {
      const vacs = state.vacations.filter(v=>{
        const m = parseISO(v.start).getMonth();
        return getQuarterByMonthIndex(m) === q;
      });
      const count = vacs.length;
      const daysSum = vacs.reduce((s,v)=>s+(v.workingDays||v.days||0),0);
      const uniqueEmp = new Set(vacs.map(v=>v.employeeId)).size;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${q} квартал</td>
        <td>${count}</td>
        <td>${daysSum}</td>
        <td>${uniqueEmp}</td>
      `;
      body.appendChild(tr);
    }
  }

  function initReportsHandlers() {
    $('#rep-refresh-btn').addEventListener('click', () => {
      renderReportsSection();
      showToast('Отчёты обновлены');
    });
  }

  // ================== КАЛЕНДАРЬ ==================
  function renderCalendarSection() {
    renderCalendarFiltersEmployees();
    renderCalendarFiltersStatuses();
    renderMonthCalendar();
    renderQuartersCalendar();
    renderCalendarUpcoming();
  }

    function renderCalendarFiltersEmployees() {
    const box = $('#cal-emp-list');
    if (!box) return;
    const selected = new Set(state.calendar.filters.employeeIds);
    box.innerHTML = '';
    for (const e of state.employees) {
      const id = `cal-emp-${e.id}`;
      const wrapper = document.createElement('label');
      wrapper.className = 'emp-checkbox';
      wrapper.dataset.name = e.name.toLowerCase();
      let checked = '';
      if (selected.has(-1)) {
        // никто не выбран
        checked = '';
      } else if (selected.size === 0 || selected.has(e.id)) {
        checked = 'checked';
      }
      wrapper.innerHTML = `<input type="checkbox" id="${id}" value="${e.id}" ${checked}>
        <span>${e.name}</span>`;
      box.appendChild(wrapper);
    }
    // если не было сохранённых значений, employeeIds остаётся пустым => трактуем как "все"
    }

  function renderCalendarFiltersStatuses() {
    const box = $('#cal-status-list');
    const selected = state.calendar.filters.statuses;
    box.innerHTML = '';
    for (const st of STATUSES) {
      const id = `cal-status-${st}`;
      const label = document.createElement('label');
      label.className = 'status-checkbox';
      label.innerHTML = `<input type="checkbox" id="${id}" value="${st}" ${selected.has(st)?'checked':''}>
        <span>${st}</span>`;
      box.appendChild(label);
    }
  }

  function calendarSelectedEmployeeIds() {
    const checked = $$('#cal-emp-list input[type="checkbox"]:checked');
    const ids = new Set(checked.map(i=>Number(i.value)));
    if (ids.size === 0) {
      ids.add(-1); // никто не выбран
    }
    state.calendar.filters.employeeIds = ids;
    return ids;
  }

  function calendarSelectedStatuses() {
    const checked = $$('#cal-status-list input[type="checkbox"]:checked');
    const set = new Set(checked.map(i=>i.value));
    if (!set.size) {
      // не оставляем полностью пустой набор
      STATUSES.forEach(s=>set.add(s));
      renderCalendarFiltersStatuses();
    }
    state.calendar.filters.statuses = set;
    return set;
  }

  function vacationPassesCalendarFilters(v) {
    const ids = state.calendar.filters.employeeIds;
    const statuses = state.calendar.filters.statuses;
    if (ids.size && !ids.has(v.employeeId)) return false;
    if (statuses.size && !statuses.has(v.status)) return false;
    return true;
  }

  function vacationsForDay(iso) {
    return state.vacations.filter(v => {
      if (!vacationPassesCalendarFilters(v)) return false;
      return v.start <= iso && v.end >= iso;
    });
  }

  function isConflictOnDay(iso, vacsForDay) {
    if (isWeekendISO(iso)) return false; // по условию игнорируем выходные
    const arr = vacsForDay || vacationsForDay(iso);
    if (arr.length < 2) return false;
    for (let i=0;i<arr.length;i++) {
      for (let j=i+1;j<arr.length;j++) {
        const v1 = arr[i];
        const v2 = arr[j];
        if (!areEmployeesInConflictGroup(v1.employeeId, v2.employeeId)) continue;
        if (overlapOnWorkingDays(v1.start, v1.end, v2.start, v2.end)) return true;
      }
    }
    return false;
  }

  function renderMonthCalendar() {
    const tbody = $('#cal-month-body');
    const label = $('#cal-month-label');
    const month = state.calendar.month;
    const year = state.calendar.year;

    label.textContent = `${MONTH_NAMES[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const firstWeekday = (firstDay.getDay() + 6) % 7; // 0-пн

    const daysInMonth = new Date(year, month+1, 0).getDate();
    tbody.innerHTML = '';

    let currentDay = 1 - firstWeekday;
    for (let week=0; week<6; week++) {
      const tr = document.createElement('tr');
      for (let wd=0; wd<7; wd++, currentDay++) {
        const td = document.createElement('td');
        td.className = 'day-cell';
        if (currentDay < 1 || currentDay > daysInMonth) {
          td.innerHTML = '&nbsp;';
        } else {
          const date = new Date(year, month, currentDay);
          const iso = formatISO(date);
          const numDiv = document.createElement('div');
          numDiv.className = 'day-number';
          numDiv.textContent = currentDay;
          td.appendChild(numDiv);

          const vacs = vacationsForDay(iso);
          const tagsBox = document.createElement('div');
          tagsBox.className = 'day-tags';

          if (vacs.length === 1) {
            const t = document.createElement('div');
            t.className = 'day-tag';
            t.textContent = `${vacs[0].name}`;
            tagsBox.appendChild(t);
          } else if (vacs.length > 1) {
            const t = document.createElement('div');
            t.className = 'day-tag';
            t.textContent = `${vacs.length} отпусков`;
            tagsBox.appendChild(t);
          }

          td.appendChild(tagsBox);

          if (isWeekendISO(iso)) td.classList.add('day-weekend');
          if (isHolidayISO(iso)) td.classList.add('day-holiday');
          if (isPreHolidayISO(iso)) td.classList.add('day-preholiday');
          if (vacs.length) td.classList.add('day-hasvac');
          if (isConflictOnDay(iso, vacs)) td.classList.add('day-conflict');
          if (vacs.length) {
            td.title = vacs.map(v=>`${v.name}: ${formatHuman(v.start)}–${formatHuman(v.end)} (${v.status})`).join('\n');
          }
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderQuartersCalendar() {
    const grid = $('#quarters-grid');
    grid.innerHTML = '';
    for (let q=1;q<=4;q++) {
      const card = document.createElement('div');
      card.className = 'quarter-card';
      card.dataset.q = String(q);

      const header = document.createElement('div');
      header.className = 'quarter-header';
      const title = document.createElement('div');
      title.className = 'quarter-title';
      title.textContent = `${q} квартал ${YEAR}`;
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-ghost btn-xs quarter-vac-toggle';
      toggleBtn.textContent = 'Скрыть список';
      header.appendChild(title);
      header.appendChild(toggleBtn);
      card.appendChild(header);

      const monthsBox = document.createElement('div');
      monthsBox.className = 'quarter-months';
      const months = [(q-1)*3, (q-1)*3+1, (q-1)*3+2];
      for (const m of months) {
        const mWrap = document.createElement('div');
        mWrap.className = 'quarter-month';
        mWrap.dataset.month = String(m); // Добавляем data-атрибут с индексом месяца
        const name = document.createElement('div');
        name.className = 'quarter-month-name';
        name.textContent = MONTH_NAMES[m];
        mWrap.appendChild(name);

        const table = document.createElement('table');
        table.className = 'qmonth-table';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => {
          const th = document.createElement('th');
          th.textContent = d;
          trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const firstDay = new Date(YEAR, m, 1);
        const firstWeekday = (firstDay.getDay() + 6) % 7;
        const daysInMonth = new Date(YEAR, m+1, 0).getDate();
        let currentDay = 1 - firstWeekday;

        for (let week=0; week<6; week++) {
          const tr = document.createElement('tr');
          for (let wd=0; wd<7; wd++, currentDay++) {
            const td = document.createElement('td');
            td.className = 'qday';
            if (currentDay < 1 || currentDay > daysInMonth) {
              td.textContent = '';
            } else {
              const date = new Date(YEAR, m, currentDay);
              const iso = formatISO(date);
              td.textContent = currentDay;
              const vacs = vacationsForDay(iso);
              if (isWeekendISO(iso)) td.classList.add('qday-weekend');
              if (isHolidayISO(iso)) td.classList.add('qday-holiday');
              if (isPreHolidayISO(iso)) td.classList.add('qday-preholiday');
              if (vacs.length) td.classList.add('qday-hasvac');
              if (isConflictOnDay(iso, vacs)) td.classList.add('qday-conflict');
              if (vacs.length) {
                td.title = vacs.map(v=>`${v.name}: ${formatHuman(v.start)}–${formatHuman(v.end)} (${v.status})`).join('\n');
              }
            }
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        mWrap.appendChild(table);
        monthsBox.appendChild(mWrap);
      }
      card.appendChild(monthsBox);

      // Список отпусков квартала
      const vacBox = document.createElement('div');
      vacBox.className = 'quarter-vac-list';
      const qVacations = state.vacations
        .filter(v=>vacationPassesCalendarFilters(v))
        .filter(v=>{
          const m = parseISO(v.start).getMonth();
          return getQuarterByMonthIndex(m) === q;
        })
        .sort((a,b)=>compareISO(a.start,b.start));

      if (qVacations.length) {
        const list = document.createElement('div');
        for (const v of qVacations) {
          const div = document.createElement('div');
          div.className = 'quarter-vac-item';
          div.textContent = `${v.name}: ${formatHuman(v.start)} – ${formatHuman(v.end)} · ${v.workingDays||v.days} дн.`;
          list.appendChild(div);
        }
        vacBox.appendChild(list);
      } else {
        const span = document.createElement('div');
        span.className = 'quarter-vac-item';
        span.textContent = 'В этом квартале отпусков нет.';
        vacBox.appendChild(span);
      }
      card.appendChild(vacBox);

      toggleBtn.addEventListener('click', () => {
        const hidden = vacBox.style.display === 'none';
        vacBox.style.display = hidden ? '' : 'none';
        toggleBtn.textContent = hidden ? 'Скрыть список' : 'Показать список';
      });

      grid.appendChild(card);
    }

    // Делегированный обработчик для кликов по месяцам в квартальном виде
    grid.addEventListener('click', (e) => {
      const monthWrap = e.target.closest('.quarter-month[data-month]');
      if (!monthWrap) return;

      const monthIndex = Number(monthWrap.dataset.month);

      // Меняем состояние
      state.calendar.view = 'month';
      state.calendar.month = monthIndex;

      // Обновляем UI
      $$('[data-cal-view]').forEach(b => b.classList.toggle('segmented-btn-active', b.dataset.calView === 'month'));
      $('#cal-view-month').classList.remove('hidden');
      $('#cal-view-quarters').classList.add('hidden');
      renderMonthCalendar();
    });
  }

  function renderCalendarUpcoming() {
    const ul = $('#cal-upcoming-list');
    if (state.calendar.upcomingCollapsed) {
      ul.style.display = 'none';
    } else {
      ul.style.display = '';
    }
    ul.innerHTML = '';
    const upcoming = state.vacations
      .filter(v=>v.status==='Запланирован')
      .slice()
      .sort((a,b)=>compareISO(a.start,b.start))
      .slice(0,5);
    for (const v of upcoming) {
      const li = document.createElement('li');
      li.className = 'upcoming-item';
      li.dataset.id = v.id;
      li.innerHTML = `
        <div class="upcoming-item-title">${v.name}</div>
        <div class="upcoming-item-meta">${formatHuman(v.start)} – ${formatHuman(v.end)} · ${v.workingDays||v.days} дн.</div>
      `;
      ul.appendChild(li);
    }
  }

  function initCalendarHandlers() {
    $('#cal-prev').addEventListener('click', () => {
      state.calendar.month--;
      if (state.calendar.month < 0) {
        state.calendar.month = 11;
      }
      renderMonthCalendar();
    });
    $('#cal-next').addEventListener('click', () => {
      state.calendar.month++;
      if (state.calendar.month > 11) {
        state.calendar.month = 0;
      }
      renderMonthCalendar();
    });

    // переключатель вида
    $$('[data-cal-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.calView;
        state.calendar.view = view;
        $$('[data-cal-view]').forEach(b=>b.classList.toggle('segmented-btn-active', b===btn));
        $('#cal-view-month').classList.toggle('hidden', view!=='month');
        $('#cal-view-quarters').classList.toggle('hidden', view!=='quarters');
      });
    });

    // фильтр сотрудников
    $('#cal-emp-search').addEventListener('input', () => {
      const q = $('#cal-emp-search').value.trim().toLowerCase();
      $$('.emp-checkbox').forEach(el => {
        const name = el.dataset.name || '';
        el.style.display = !q || name.includes(q) ? '' : 'none';
      });
    });
    $('#cal-emp-list').addEventListener('change', () => {
      calendarSelectedEmployeeIds();
      renderCalendarSection();
    });
    $('#cal-emp-select-all').addEventListener('click', () => {
      state.calendar.filters.employeeIds = new Set(state.employees.map(e=>e.id));
      renderCalendarSection();
    });
    $('#cal-emp-select-none').addEventListener('click', () => {
      state.calendar.filters.employeeIds = new Set([-1]);
      renderCalendarSection();
    });

    // фильтр статусов
    $('#cal-status-list').addEventListener('change', () => {
      calendarSelectedStatuses();
      renderCalendarSection();
    });
    $('#cal-status-all').addEventListener('click', () => {
      $$('#cal-status-list input[type="checkbox"]').forEach(cb=>cb.checked=true);
      calendarSelectedStatuses();
      renderCalendarSection();
    });
    $('#cal-status-planned').addEventListener('click', () => {
      $$('#cal-status-list input[type="checkbox"]').forEach(cb=>{
        cb.checked = cb.value === 'Запланирован';
      });
      calendarSelectedStatuses();
      renderCalendarSection();
    });

    // ближайшие отпуска
    $('#cal-upcoming-toggle').addEventListener('click', () => {
      state.calendar.upcomingCollapsed = !state.calendar.upcomingCollapsed;
      renderCalendarUpcoming();
    });
    $('#cal-upcoming-list').addEventListener('click', (e) => {
      const li = e.target.closest('.upcoming-item');
      if (!li) return;
      const id = Number(li.dataset.id);
      const v = state.vacations.find(x=>x.id===id);
      if (!v) return;
      // переключимся на вкладку "Отпуска" и откроем форму редактирования
      $$('.tab').forEach(t=>{
        const tabKey = t.dataset.tab;
        const active = tabKey==='vacations';
        t.classList.toggle('tab-active', active);
        $('#tab-'+tabKey).classList.toggle('tab-panel-active', active);
      });
      $('#vac-id').value = v.id;
      $('#vac-emp').value = String(v.employeeId);
      $('#vac-start').value = v.start;
      $('#vac-end').value = v.end;
      $('#vac-status').value = v.status;
      renderVacationEmployeeInfo();
      updateVacationMetricsPreview();
      if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
    });
  }

  // ================== CSV И ДАННЫЕ ==================
  function detectDelimiter(headerLine) {
    if (headerLine.includes(';')) return ';';
    if (headerLine.includes(',')) return ',';
    return ';';
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    if (!lines.length) return {header:[], rows:[]};
    const delimiter = detectDelimiter(lines[0]);
    const header = lines[0].split(delimiter).map(h=>h.trim());
    const rows = lines.slice(1).map(line => line.split(delimiter).map(c=>c.trim()));
    return {header, rows};
  }

  function exportEmployeesCsv() {
    const header = ['name','totalVacationDays'];
    const rows = state.employees.map(e=>[e.name, String(e.totalVacationDays)]);
    downloadCsv('employees_export.csv', header, rows);
  }

  function exportVacationsCsv() {
    const header = ['employeeName','start','end','status'];
    const rows = state.vacations.map(v=>[v.name, v.start, v.end, v.status]);
    downloadCsv('vacations_export.csv', header, rows);
  }

  function downloadCsv(filename, header, rows) {
    const delimiter = ';';
    const esc = (val) => {
      if (val == null) return '';
      const s = String(val);
      if (s.includes(delimiter) || s.includes('"')) {
        return '"' + s.replace(/"/g,'""') + '"';
      }
      return s;
    };
    const all = [header, ...rows];
    const text = all.map(row => row.map(esc).join(delimiter)).join('\r\n');
    const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importEmployeesCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const {header, rows} = parseCsv(reader.result);
      const idxName = header.findIndex(h=>h.toLowerCase()==='name');
      const idxTotal = header.findIndex(h=>h.toLowerCase()==='totalvacationdays');
      if (idxName === -1 || idxTotal === -1) {
        showToast('В файле сотрудников должны быть колонки name,totalVacationDays');
        return;
      }
      if (!confirm('Импорт сотрудников перезапишет сотрудников, отпуска и группы пересечений. Продолжить?')) return;

      const employees = [];
      for (let i=0;i<rows.length;i++) {
        const cells = rows[i];
        const name = cells[idxName];
        const total = Number(cells[idxTotal] || 0);
        if (!name || !total) continue;
        employees.push({
          id: Date.now() + i,
          name,
          totalVacationDays: total,
          usedVacationDays: 0
        });
      }
      state.employees = employees;
      state.vacations = [];
      state.conflictGroups = [];
      commitAndRender('Список сотрудников импортирован, отпуска и группы очищены');
    };
    reader.readAsText(file, 'utf-8');
  }

  function importVacationsCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const {header, rows} = parseCsv(reader.result);
      const idxName = header.findIndex(h=>h.toLowerCase()==='employeename');
      const idxStart = header.findIndex(h=>h.toLowerCase()==='start');
      const idxEnd = header.findIndex(h=>h.toLowerCase()==='end');
      const idxStatus = header.findIndex(h=>h.toLowerCase()==='status');
      if (idxName === -1 || idxStart===-1 || idxEnd===-1) {
        showToast('В файле отпусков должны быть колонки employeeName,start,end,status');
        return;
      }
      if (!confirm('Импорт отпусков перезапишет все текущие отпуска. Продолжить?')) return;

      const vacations = [];
      let skipped = 0;
      rows.forEach((cells, i) => {
        const name = cells[idxName];
        const startIso = cells[idxStart];
        const endIso = cells[idxEnd];
        const status = cells[idxStatus] || 'Запланирован';
        if (!name || !startIso || !endIso) { skipped++; return; }
        const emp = state.employees.find(e=>e.name===name);
        if (!emp) { skipped++; return; }
        const m = calcVacationMetrics(startIso, endIso);
        if (!m) { skipped++; return; }
        vacations.push({
          id: Date.now() + i,
          employeeId: emp.id,
          name: emp.name,
          start: startIso,
          end: endIso,
          days: m.vacationDays,
          workingDays: m.workingDays,
          status
        });
      });
      state.vacations = vacations;
      commitAndRender('Отпуска импортированы. Пропущено строк: '+skipped);
    };
    reader.readAsText(file, 'utf-8');
  }

  function initDataHandlers() {
    $('#export-employees-btn').addEventListener('click', exportEmployeesCsv);
    $('#export-vacations-btn').addEventListener('click', exportVacationsCsv);

    $('#import-employees-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      importEmployeesCsv(file);
      e.target.value = '';
    });
    $('#import-vacations-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      importVacationsCsv(file);
      e.target.value = '';
    });

    $('#clear-storage-btn').addEventListener('click', () => {
      if (!confirm('Очистить данные системы отпусков?')) return;
      clearStorageAndReset();
    });
  }

  // ================== ИНИЦИАЛИЗАЦИЯ ==================
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initTabsAndTheme();
    initEmployeesHandlers();
    initVacationsHandlers();
    initConflictsHandlers();
    initReportsHandlers();
    initCalendarHandlers();
    initDataHandlers();
    renderAll();
  });

})();
