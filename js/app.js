(function() {
  'use strict';

  // ================== КОНСТАНТЫ И СОСТОЯНИЕ ==================
  const YEAR = 2026;
  const EMPLOYEES_KEY = 'employees';
  const VACATIONS_KEY = 'vacations';
  const CONFLICT_GROUPS_KEY = 'conflictGroups';

  const STATUSES = ['Запланирован', 'Использован', 'Отменен', 'Перенесен'];

  // Праздничные дни 2026 - будут загружены из CSV
  let HOLIDAYS_2026 = [];
  let PRE_HOLIDAYS_2026 = [];

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

  // ================== ЗАГРУЗКА ПРАЗДНИКОВ ==================
  async function loadHolidaysFromCSV() {
    try {
      const response = await fetch('templates/holidays.csv');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const csvText = await response.text();

      // Парсим CSV
      const lines = csvText.trim().split('\n');
      const data = [];

      // Пропускаем заголовок
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          const [date, type] = line.split(',');
          if (date && type) {
            data.push({ date: date.trim(), type: type.trim() });
          }
        }
      }

      // Разделяем по типам
      HOLIDAYS_2026 = data.filter(d => d.type === 'holiday').map(d => d.date);
      PRE_HOLIDAYS_2026 = data.filter(d => d.type === 'preholiday').map(d => d.date);

      console.log(`Загружено праздников: ${HOLIDAYS_2026.length}, предпраздничных дней: ${PRE_HOLIDAYS_2026.length}`);
      return true;
    } catch (error) {
      console.error('Ошибка при загрузке holidays.csv:', error);
      // Устанавливаем резервные значения
      HOLIDAYS_2026 = [
        '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09','2026-01-10','2026-01-11',
        '2026-02-23','2026-03-08','2026-05-01','2026-05-09','2026-06-12','2026-11-04','2026-12-31'
      ];
      PRE_HOLIDAYS_2026 = ['2026-04-30','2026-05-08','2026-06-11','2026-11-03'];
      console.log('Используются резервные значения праздников');
      return false;
    }
  }

  // ================== ВАЛИДАЦИЯ ПОЛЕЙ ==================
  function validateTextField(element, value, minLength = 1) {
    const trimmed = String(value || '').trim();
    if (trimmed.length < minLength) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Поле обязательно для заполнения' };
    }
    // Проверка на спецсимволы (базовая защита от инъекций)
    if (/<|>|&lt;|&gt;|javascript:|on\w+=/i.test(trimmed)) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Недопустимые символы в поле' };
    }
    element.classList.remove('is-invalid');
    element.classList.add('is-valid');
    return { valid: true, value: trimmed };
  }

  function validateNumberField(element, value, { min = null, max = null, allowFloat = false } = {}) {
    const str = String(value || '').trim();

    // Проверка, что это число
    if (str === '' || isNaN(str)) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Введите корректное число' };
    }

    const num = allowFloat ? parseFloat(str) : parseInt(str, 10);

    // Проверка на NaN после парсинга
    if (isNaN(num)) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Введите корректное число' };
    }

    // Проверка целочисленности, если float не разрешен
    if (!allowFloat && !Number.isInteger(num)) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Введите целое число' };
    }

    // Проверка минимального значения
    if (min !== null && num < min) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: `Минимальное значение: ${min}` };
    }

    // Проверка максимального значения
    if (max !== null && num > max) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: `Максимальное значение: ${max}` };
    }

    element.classList.remove('is-invalid');
    element.classList.add('is-valid');
    return { valid: true, value: num };
  }

  function validateSelectField(element, value, allowEmpty = false) {
    const trimmed = String(value || '').trim();
    if (!allowEmpty && (trimmed === '' || trimmed === '0')) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Выберите значение из списка' };
    }
    element.classList.remove('is-invalid');
    element.classList.add('is-valid');
    return { valid: true, value: trimmed };
  }

  function validateDateField(element, value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Выберите дату' };
    }
    // Проверка формата YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Неверный формат даты' };
    }
    const date = parseISO(trimmed);
    if (!date || isNaN(date.getTime())) {
      element.classList.add('is-invalid');
      element.classList.remove('is-valid');
      return { valid: false, message: 'Некорректная дата' };
    }
    element.classList.remove('is-invalid');
    element.classList.add('is-valid');
    return { valid: true, value: trimmed };
  }

  function clearValidation(element) {
    element.classList.remove('is-invalid', 'is-valid');
  }

  function showValidationErrors(errors) {
    if (errors.length > 0) {
      showToast(errors[0]); // Показываем первую ошибку
    }
  }

  // ================== TOAST ==================
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

    // Учитываем только запланированные и использованные отпуска (исключаем отмененные и перенесенные)
    const activeVacations = state.vacations.filter(v =>
      v.status === 'Запланирован' || v.status === 'Использован'
    );

    for (let i=0; i<activeVacations.length; i++) {
      for (let j=i+1; j<activeVacations.length; j++) {
        const v1 = activeVacations[i];
        const v2 = activeVacations[j];
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
      tr.dataset.id = emp.id;
      tr.dataset.name = emp.name;
      tr.dataset.totalVacationDays = emp.totalVacationDays;
      tr.dataset.usedVacationDays = emp.usedVacationDays;
      tr.dataset.left = left;
      tr.dataset.pct = pct;
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
    const nameEl = $('#emp-name');
    const totalEl = $('#emp-total');

    // Валидация в реальном времени при вводе данных
    nameEl.addEventListener('input', () => {
      clearValidation(nameEl);
    });

    totalEl.addEventListener('input', () => {
      clearValidation(totalEl);
    });

    totalEl.addEventListener('blur', () => {
      if (totalEl.value.trim()) {
        validateNumberField(totalEl, totalEl.value, { min: 1, max: 366, allowFloat: false });
      }
    });

    cancel.addEventListener('click', () => {
      form.reset();
      $('#emp-id').value = '';
      clearValidation(nameEl);
      clearValidation(totalEl);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const idVal = $('#emp-id').value.trim();
      const name = nameEl.value.trim();
      const totalValue = totalEl.value.trim();

      // Массив для сбора ошибок валидации
      const errors = [];

      // Валидация имени
      const nameValidation = validateTextField(nameEl, name, 1);
      if (!nameValidation.valid) {
        errors.push(`ФИО: ${nameValidation.message}`);
      }

      // Валидация количества дней
      const totalValidation = validateNumberField(totalEl, totalValue, { min: 1, max: 366, allowFloat: false });
      if (!totalValidation.valid) {
        errors.push(`Отпускные дни: ${totalValidation.message}`);
      }

      // Если есть ошибки, показываем и прерываем отправку
      if (errors.length > 0) {
        showValidationErrors(errors);
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const validatedName = nameValidation.value;
      const validatedTotal = totalValidation.value;

      if (idVal) {
        const emp = state.employees.find(e=>String(e.id)===idVal);
        if (emp) {
          emp.name = validatedName;
          emp.totalVacationDays = validatedTotal;
          // обновим имя во всех отпусках и группах
          state.vacations.forEach(v=>{ if (v.employeeId===emp.id) v.name = validatedName; });
          state.conflictGroups.forEach(g=>{
            if (g.employee1Id===emp.id) g.employee1Name = validatedName;
            if (g.employee2Id===emp.id) g.employee2Name = validatedName;
          });
          commitAndRender('Сотрудник обновлён');
          // Очищаем форму и валидацию после успешного обновления
          $('#emp-id').value = '';
          form.reset();
          clearValidation(nameEl);
          clearValidation(totalEl);
        }
      } else {
        const id = Date.now();
        state.employees.push({
          id,
          name: validatedName,
          totalVacationDays: validatedTotal,
          usedVacationDays: 0
        });
        commitAndRender('Сотрудник добавлен');
        $('#emp-id').value = '';
        form.reset();
        clearValidation(nameEl);
        clearValidation(totalEl);
      }
      setTimeout(() => { submitBtn.disabled = false; }, 1000);
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
        // Очищаем валидацию при редактировании
        clearValidation(nameEl);
        clearValidation(totalEl);
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
      tr.dataset.id = v.id;
      tr.dataset.name = v.name;
      tr.dataset.start = v.start;
      tr.dataset.end = v.end;
      tr.dataset.days = v.workingDays || v.days;
      tr.dataset.status = v.status;
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

    function updateHoverState() {
      const anchor = picker.anchorIso;
      const hover = picker.hoverIso;
      const endIso = endField.value || null;

      // Обновляем классы hover без пересоздания DOM
      grid.querySelectorAll('button.date-range-day').forEach(btn => {
        const iso = btn.dataset.iso;
        if (!iso) return;

        // Убираем старые классы hover
        btn.classList.remove('is-hover-range');

        // Добавляем новые классы hover если нужно
        if (anchor && !endIso && hover && inRange(iso, anchor, hover)) {
          btn.classList.add('is-hover-range');
        }
      });
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
            updateHoverState();
          }
        });

        btn.addEventListener('mouseleave', () => {
          const s = startField.value;
          const e = endField.value;
          if (s && !e && picker.hoverIso === iso) {
            picker.hoverIso = null;
            updateHoverState();
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
    popover.addEventListener('click', () => {
      // Не используем stopPropagation, чтобы не блокировать обработку кликов
    });
    rangeInput.addEventListener('click', () => {
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
    // Проверяем, что клик был не по кнопке даты
    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      // Если клик внутри wrap или по кнопке даты - не закрываем
      if (wrap.contains(e.target)) return;
      closePopover();
    });

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') closePopover();
    });

    // Делегированный обработчик: ставим один раз, потому что кнопки дней пересоздаются в render().
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button.date-range-day');
      console.log('Grid click:', { btn, disabled: btn?.disabled, target: e.target });
      if (!btn || btn.disabled) return;

      // Останавливаем всплытие, чтобы не сработал обработчик закрытия на document
      e.stopPropagation();

      const iso = btn.dataset.iso;
      if (!iso) return;

      const currentStart = startField.value || null;
      const currentEnd = endField.value || null;
      console.log('Date click:', { iso, currentStart, currentEnd });

      // 1-й клик (или новый выбор после полного диапазона)
      if (!currentStart || currentEnd) {
        console.log('Setting start date');
        picker.anchorIso = iso;
        picker.hoverIso = null;
        applyRangeToFields(iso, '', { close: false });
        render();
        return;
      }

      // 2-й клик -> end
      console.log('Setting end date');
      let s = currentStart;
      let end = iso;
      if (compareISO(end, s) < 0) {
        const tmp = s; s = end; end = tmp;
      }
      picker.anchorIso = null;
      picker.hoverIso = null;
      applyRangeToFields(s, end, { close: true });
    });

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
    const rangeInput = $('#vac-range');

    empSelect.addEventListener('change', () => {
      clearValidation(empSelect);
      renderVacationEmployeeInfo();
    });

    // ISO-поля скрытые, но продолжаем слушать изменения
    $('#vac-start').addEventListener('change', () => {
      clearValidation(rangeInput);
      updateVacationMetricsPreview();
      if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
    });
    $('#vac-end').addEventListener('change', () => {
      clearValidation(rangeInput);
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
      $('#vac-start').value = '';
      $('#vac-end').value = '';
      clearValidation(empSelect);
      clearValidation(rangeInput);
      renderVacationEmployeeInfo();
      $('#vac-days-info').textContent = 'Отпускные дни будут посчитаны после выбора дат.';
      if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const idVal = $('#vac-id').value.trim();
      const empId = Number($('#vac-emp').value);
      const emp = state.employees.find(e=>e.id===empId);
      const startEl = $('#vac-start');
      const endEl = $('#vac-end');
      const empEl = $('#vac-emp');

      // Массив для сбора ошибок валидации
      const errors = [];

      // Валидация выбора сотрудника
      const empValidation = validateSelectField(empEl, empId, false);
      if (!empValidation.valid || !emp) {
        empEl.classList.add('is-invalid');
        empEl.classList.remove('is-valid');
        errors.push('Сотрудник: Выберите сотрудника из списка');
      } else {
        empEl.classList.remove('is-invalid');
        empEl.classList.add('is-valid');
      }

      // Валидация дат
      const startValidation = validateDateField(startEl, startEl.value);
      const endValidation = validateDateField(endEl, endEl.value);

      if (!startValidation.valid || !endValidation.valid) {
        rangeInput.classList.add('is-invalid');
        rangeInput.classList.remove('is-valid');
        errors.push('Диапазон дат: Выберите корректные даты начала и окончания');
      } else {
        rangeInput.classList.remove('is-invalid');
        rangeInput.classList.add('is-valid');
      }

      // Если есть ошибки, показываем и прерываем отправку
      if (errors.length > 0) {
        showValidationErrors(errors);
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const startIso = startEl.value;
      const endIso = endEl.value;

      // Проверка корректности диапазона
      if (compareISO(startIso, endIso) > 0) {
        rangeInput.classList.add('is-invalid');
        rangeInput.classList.remove('is-valid');
        showToast('Дата начала не может быть позже даты окончания');
        submitBtn.disabled = false;
        return;
      }

      const metrics = calcVacationMetrics(startIso, endIso);
      if (!metrics) {
        rangeInput.classList.add('is-invalid');
        rangeInput.classList.remove('is-valid');
        showToast('Неверный диапазон дат');
        submitBtn.disabled = false;
        return;
      }

      const status = $('#vac-status').value || 'Запланирован';

      // Проверка лимита дней для сотрудника с учётом всех отпусков кроме редактируемого
      const existing = state.vacations.filter(v => v.employeeId === emp.id && v.id !== (idVal ? Number(idVal) : -1) && v.status !== 'Отменен');
      const usedOther = existing.reduce((sum,v)=>sum+(v.workingDays||v.days||0),0);
      const totalAfter = usedOther + metrics.vacationDays;
      if (totalAfter > emp.totalVacationDays) {
        rangeInput.classList.add('is-invalid');
        rangeInput.classList.remove('is-valid');
        showToast(`Недостаточно дней. После добавления будет ${totalAfter} из ${emp.totalVacationDays}.`);
        submitBtn.disabled = false;
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
      clearValidation(empSelect);
      clearValidation(rangeInput);
      renderVacationEmployeeInfo();
      $('#vac-days-info').textContent = 'Отпускные дни будут посчитаны после выбора дат.';
      setTimeout(() => { submitBtn.disabled = false; }, 1000);
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
        clearValidation(empSelect);
        clearValidation(rangeInput);
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
    const emp1Select = $('#conf-emp1');
    const emp2Select = $('#conf-emp2');

    // Очистка валидации при изменении
    emp1Select.addEventListener('change', () => {
      emp1Select.classList.remove('is-invalid');
    });
    emp2Select.addEventListener('change', () => {
      emp2Select.classList.remove('is-invalid');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id1 = Number(emp1Select.value);
      const id2 = Number(emp2Select.value);

      let isValid = true;
      if (!id1) {
        emp1Select.classList.add('is-invalid');
        emp1Select.classList.remove('is-valid');
        isValid = false;
      } else {
        emp1Select.classList.remove('is-invalid');
      }
      if (!id2) {
        emp2Select.classList.add('is-invalid');
        emp2Select.classList.remove('is-valid');
        isValid = false;
      } else {
        emp2Select.classList.remove('is-invalid');
      }

      if (!isValid) {
        showToast('Выберите обоих сотрудников');
        return;
      }

      if (id1 === id2) {
        emp1Select.classList.add('is-invalid');
        emp1Select.classList.remove('is-valid');
        emp2Select.classList.add('is-invalid');
        emp2Select.classList.remove('is-valid');
        showToast('Нужно выбрать разных сотрудников');
        return;
      }

      if (areEmployeesInConflictGroup(id1,id2)) {
        emp1Select.classList.add('is-invalid');
        emp2Select.classList.add('is-invalid');
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
      form.reset();
      emp1Select.classList.remove('is-invalid');
      emp2Select.classList.remove('is-invalid');
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
    renderTimelineCalendar();
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

    // Маппинг статусов на классы цветовых индикаторов
    const statusColorMap = {
      'Запланирован': 'legend-status-planned',
      'Использован': 'legend-status-taken',
      'Отменен': 'legend-status-cancelled',
      'Перенесен': 'legend-status-rescheduled'
    };

    for (const st of STATUSES) {
      const id = `cal-status-${st}`;
      const colorClass = statusColorMap[st] || '';
      const label = document.createElement('label');
      label.className = 'status-checkbox';
      label.innerHTML = `<input type="checkbox" id="${id}" value="${st}" ${selected.has(st)?'checked':''}>
        <span class="legend-swatch ${colorClass}"></span>
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

  function vacationsForDay(iso, includeAllStatuses = false) {
    return state.vacations.filter(v => {
      if (!vacationPassesCalendarFilters(v)) return false;
      // Для месячного и квартального календаря исключаем отмененные и перенесенные
      if (!includeAllStatuses && (v.status === 'Отменен' || v.status === 'Перенесен')) return false;
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
    let cellIndex = 0;
    for (let week=0; week<6; week++) {
      const tr = document.createElement('tr');
      for (let wd=0; wd<7; wd++, currentDay++, cellIndex++) {
        const td = document.createElement('td');
        td.className = 'day-cell';
        td.style.animationDelay = `${cellIndex * 15}ms`;
        if (currentDay < 1 || currentDay > daysInMonth) {
          td.style.visibility = 'hidden';
        } else {
          const date = new Date(year, month, currentDay);
          const iso = formatISO(date);
          const numDiv = document.createElement('div');
          numDiv.className = 'day-number';
          numDiv.textContent = currentDay;
          td.appendChild(numDiv);

          const today = new Date();
          if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === currentDay) {
            td.classList.add('day-today');
          }

          const vacs = vacationsForDay(iso);
          const tagsBox = document.createElement('div');
          tagsBox.className = 'day-tags';

          if (vacs.length === 1) {
            const t = document.createElement('div');
            t.className = 'day-tag';
            // Сокращаем длинные имена
            const shortName = vacs[0].name.length > 20 ? vacs[0].name.substring(0, 18) + '…' : vacs[0].name;
            t.textContent = shortName;
            // Добавляем цвет в зависимости от статуса (соответствует легенде статусов)
            if (vacs[0].status === 'Запланирован') {
              t.style.background = 'linear-gradient(135deg, #6a5ae0 0%, #8b7aee 100%)';
              t.style.color = '#fff';
            } else if (vacs[0].status === 'Использован') {
              t.style.background = 'linear-gradient(135deg, #74cda0 0%, #74cda0 100%)';
              t.style.color = '#fff';
              t.style.opacity = '0.85';
            } else if (vacs[0].status === 'Отменен') {
              t.style.background = 'linear-gradient(135deg, #999 0%, #aaa 100%)';
              t.style.color = '#fff';
              t.style.opacity = '0.7';
            } else if (vacs[0].status === 'Перенесен') {
              t.style.background = 'linear-gradient(135deg, #ffa726 0%, #ffb74d 100%)';
              t.style.color = '#fff';
            }
            tagsBox.appendChild(t);
          } else if (vacs.length > 1) {
            const t = document.createElement('div');
            t.className = 'day-tag';
            t.textContent = `👥 ${vacs.length} отпусков`;
            t.style.fontWeight = '700';
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

              const today = new Date();
              if (today.getFullYear() === YEAR && today.getMonth() === m && today.getDate() === currentDay) {
                td.classList.add('qday-today');
              }

              const vacs = vacationsForDay(iso);
              if (isWeekendISO(iso)) td.classList.add('qday-weekend');
              if (isHolidayISO(iso)) td.classList.add('qday-holiday');
              if (isPreHolidayISO(iso)) td.classList.add('qday-preholiday');

              // Добавляем стили в зависимости от статуса отпуска (приоритет: конфликт > статус)
              if (isConflictOnDay(iso, vacs)) {
                td.classList.add('qday-conflict');
              } else if (vacs.length) {
                // Если есть отпуска, применяем цвет в зависимости от статуса
                const firstVac = vacs[0];
                if (firstVac.status === 'Запланирован') {
                  td.style.background = 'linear-gradient(135deg, #e5e3ff 0%, #d4d1ff 100%)';
                  td.style.borderColor = '#6a5ae0';
                  td.style.fontWeight = '600';
                  td.style.color = '#4b3fd1';
                } else if (firstVac.status === 'Использован') {
                  td.style.background = 'linear-gradient(135deg, #d4f1e3 0%, #b8e6cf 100%)';
                  td.style.borderColor = '#74cda0';
                  td.style.fontWeight = '600';
                  td.style.color = '#2e7d32';
                  td.style.opacity = '0.85';
                } else if (firstVac.status === 'Отменен') {
                  td.style.background = 'linear-gradient(135deg, #e8e8e8 0%, #d0d0d0 100%)';
                  td.style.borderColor = '#999';
                  td.style.fontWeight = '600';
                  td.style.color = '#666';
                  td.style.opacity = '0.7';
                } else if (firstVac.status === 'Перенесен') {
                  td.style.background = 'linear-gradient(135deg, #ffe5cc 0%, #ffd4a3 100%)';
                  td.style.borderColor = '#ffa726';
                  td.style.fontWeight = '600';
                  td.style.color = '#e65100';
                }
              }

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
      $('#cal-view-timeline').classList.add('hidden');
      renderMonthCalendar();
    });
  }

  /**
   * Отрисовка таймлайн-вида календаря.
   * Показывает список сотрудников с горизонтальными полосками отпусков.
   * Каждая полоска позиционируется на временной шкале текущего месяца.
   * Полоски окрашены в зависимости от статуса отпуска.
   * При клике на полоску открывается форма редактирования отпуска.
   */
  function renderTimelineCalendar() {
    const container = $('#timeline-container');
    if (!container) return;

    const month = state.calendar.month;
    const year = state.calendar.year;

    // Получаем количество дней в месяце
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Фильтруем сотрудников
    const selectedEmployeeIds = state.calendar.filters.employeeIds;
    let employees = state.employees;
    if (selectedEmployeeIds.size > 0 && !selectedEmployeeIds.has(-1)) {
      employees = employees.filter(e => selectedEmployeeIds.has(e.id));
    }

    // Если нет сотрудников для отображения
    if (employees.length === 0) {
      container.innerHTML = '<div class="timeline-empty-state">Выберите хотя бы одного сотрудника для отображения таймлайна</div>';
      return;
    }

    // Создаем сетку
    const grid = document.createElement('div');
    grid.className = 'timeline-grid';

    // Создаем заголовок
    const headerEmployee = document.createElement('div');
    headerEmployee.className = 'timeline-header-employee';
    headerEmployee.textContent = 'Сотрудник';
    grid.appendChild(headerEmployee);

    const headerDays = document.createElement('div');
    headerDays.className = 'timeline-header-days';
    headerDays.style.gridTemplateColumns = `repeat(${daysInMonth}, 1fr)`;

    // Создаем заголовки для каждого дня
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const iso = formatISO(date);
      const dayHeader = document.createElement('div');
      dayHeader.className = 'timeline-day-header';

      if (isWeekendISO(iso)) {
        dayHeader.classList.add('weekend');
      }
      if (isHolidayISO(iso)) {
        dayHeader.classList.add('holiday');
      }
      if (isPreHolidayISO(iso)) {
        dayHeader.classList.add('preholiday');
      }

      const dayNumber = document.createElement('span');
      dayNumber.className = 'day-number';
      dayNumber.textContent = day;
      dayHeader.appendChild(dayNumber);

      const dayName = document.createElement('span');
      dayName.className = 'day-name';
      const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      dayName.textContent = dayNames[date.getDay()];
      dayHeader.appendChild(dayName);

      headerDays.appendChild(dayHeader);
    }
    grid.appendChild(headerDays);

    // Создаем строки для каждого сотрудника
    for (const employee of employees) {
      const employeeName = document.createElement('div');
      employeeName.className = 'timeline-employee-name';
      employeeName.textContent = employee.name;
      grid.appendChild(employeeName);

      const employeeDays = document.createElement('div');
      employeeDays.className = 'timeline-employee-days';
      employeeDays.style.gridTemplateColumns = `repeat(${daysInMonth}, 1fr)`;

      // Создаем ячейки для каждого дня
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const iso = formatISO(date);
        const dayCell = document.createElement('div');
        dayCell.className = 'timeline-day-cell';

        if (isWeekendISO(iso)) {
          dayCell.classList.add('weekend');
        }
        if (isHolidayISO(iso)) {
          dayCell.classList.add('holiday');
        }
        if (isPreHolidayISO(iso)) {
          dayCell.classList.add('preholiday');
        }

        employeeDays.appendChild(dayCell);
      }

      // Получаем отпуска сотрудника за текущий месяц (включая все статусы для таймлайна)
      const employeeVacations = state.vacations.filter(v => {
        if (v.employeeId !== employee.id) return false;
        if (!vacationPassesCalendarFilters(v)) return false;

        const vStart = parseISO(v.start);
        const vEnd = parseISO(v.end);
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);

        // Проверяем, пересекается ли отпуск с текущим месяцем
        // Используем getTime() для корректного сравнения дат
        return vStart.getTime() <= monthEnd.getTime() && vEnd.getTime() >= monthStart.getTime();
      });

      // Добавляем полоски отпусков
      for (const vacation of employeeVacations) {
        const vStart = parseISO(vacation.start);
        const vEnd = parseISO(vacation.end);
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);

        // Упрощенная логика расчета начала и конца отпуска в рамках текущего месяца
        let startDay, endDay;

        // Определяем начальный день в текущем месяце
        if (vStart.getFullYear() === year && vStart.getMonth() === month) {
          // Отпуск начинается в текущем месяце
          startDay = vStart.getDate();
        } else if (vStart.getTime() < monthStart.getTime()) {
          // Отпуск начался раньше - начинаем с 1-го числа
          startDay = 1;
        } else {
          // Отпуск начинается позже - пропускаем
          continue;
        }

        // Определяем конечный день в текущем месяце
        if (vEnd.getFullYear() === year && vEnd.getMonth() === month) {
          // Отпуск заканчивается в текущем месяце
          endDay = vEnd.getDate();
        } else if (vEnd.getTime() > monthEnd.getTime()) {
          // Отпуск продолжается дальше - заканчиваем последним днем месяца
          endDay = daysInMonth;
        } else {
          // Отпуск закончился раньше - пропускаем
          continue;
        }

        const duration = endDay - startDay + 1;
        const cellWidth = 100 / daysInMonth; // ширина одной ячейки в процентах

        const vacationBar = document.createElement('div');
        vacationBar.className = 'timeline-vacation-bar';

        // Маппинг статусов на CSS-классы
        const statusMap = {
          'Запланирован': 'planned',
          'Использован': 'taken',
          'Отменен': 'cancelled',
          'Перенесен': 'rescheduled'
        };
        const statusClass = statusMap[vacation.status] || 'planned';
        vacationBar.classList.add(`status-${statusClass}`);

        // Проверяем на конфликт
        if (state.conflictVacationIds.has(vacation.id)) {
          vacationBar.classList.add('conflict');
        }

        // Позиционируем полоску
        vacationBar.style.left = `${(startDay - 1) * cellWidth}%`;
        vacationBar.style.width = `${duration * cellWidth}%`;

        // Добавляем текст (только если достаточно места)
        const label = document.createElement('span');
        label.className = 'timeline-vacation-label';
        if (duration >= 3) {
          label.textContent = `${formatHuman(vacation.start)} – ${formatHuman(vacation.end)}`;
        } else {
          label.textContent = `${duration}д`;
        }
        vacationBar.appendChild(label);

        // Добавляем tooltip
        vacationBar.title = `${employee.name}\n${formatHuman(vacation.start)} – ${formatHuman(vacation.end)}\n${vacation.workingDays || vacation.days} рабочих дней\nСтатус: ${vacation.status}`;

        // Добавляем обработчик клика для редактирования
        vacationBar.addEventListener('click', () => {
          // Переключаемся на вкладку отпусков и открываем редактирование
          $$('.tab').forEach(t => {
            const tabKey = t.dataset.tab;
            const active = tabKey === 'vacations';
            t.classList.toggle('tab-active', active);
            $('#tab-' + tabKey).classList.toggle('tab-panel-active', active);
          });
          $('#vac-id').value = vacation.id;
          $('#vac-emp').value = String(vacation.employeeId);
          $('#vac-start').value = vacation.start;
          $('#vac-end').value = vacation.end;
          $('#vac-status').value = vacation.status;
          renderVacationEmployeeInfo();
          updateVacationMetricsPreview();
          if (window.__syncVacationRangePicker) window.__syncVacationRangePicker();
        });

        employeeDays.appendChild(vacationBar);
      }

      grid.appendChild(employeeDays);
    }

    container.innerHTML = '';
    container.appendChild(grid);
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
      renderCalendarSection();
    });
    $('#cal-next').addEventListener('click', () => {
      state.calendar.month++;
      if (state.calendar.month > 11) {
        state.calendar.month = 0;
      }
      renderCalendarSection();
    });

    // переключатель вида
    $$('[data-cal-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.calView;
        state.calendar.view = view;
        $$('[data-cal-view]').forEach(b=>b.classList.toggle('segmented-btn-active', b===btn));
        $('#cal-view-month').classList.toggle('hidden', view!=='month');
        $('#cal-view-quarters').classList.toggle('hidden', view!=='quarters');
        $('#cal-view-timeline').classList.toggle('hidden', view!=='timeline');
        renderCalendarSection();
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

  function initTableSorters() {
    document.querySelectorAll('.simple-table th[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => {
        const table = th.closest('table');
        const tbody = table.querySelector('tbody');
        const key = th.dataset.sortKey;
        const currentOrder = th.classList.contains('sort-asc') ? 'asc' : (th.classList.contains('sort-desc') ? 'desc' : 'none');

        let nextOrder = 'asc';
        if (currentOrder === 'asc') nextOrder = 'desc';
        if (currentOrder === 'desc') nextOrder = 'asc';

        table.querySelectorAll('th[data-sort-key]').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(`sort-${nextOrder}`);

        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
          let valA = a.dataset[key];
          let valB = b.dataset[key];

          // Преобразуем в числа, если это возможно
          const numA = parseFloat(valA);
          const numB = parseFloat(valB);
          if (!isNaN(numA) && !isNaN(numB)) {
            valA = numA;
            valB = numB;
          }

          let comparison = 0;
          if (valA > valB) {
            comparison = 1;
          } else if (valA < valB) {
            comparison = -1;
          }
          return nextOrder === 'desc' ? -comparison : comparison;
        });

        tbody.innerHTML = '';
        rows.forEach(row => tbody.appendChild(row));
      });
    });
  }

  // ================== ИНИЦИАЛИЗАЦИЯ ==================
  document.addEventListener('DOMContentLoaded', async () => {
    // Сначала загружаем праздники из CSV
    await loadHolidaysFromCSV();

    // Затем инициализируем приложение
    loadState();
    initTabsAndTheme();
    initEmployeesHandlers();
    initVacationsHandlers();
    initConflictsHandlers();
    initReportsHandlers();
    initCalendarHandlers();
    initDataHandlers();
    initTableSorters();
    renderAll();
  });

})();
