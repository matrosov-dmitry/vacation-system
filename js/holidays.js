// Праздничные дни 2026 - загружаются из holidays.csv
let HOLIDAYS_2026 = [];
let PRE_HOLIDAYS_2026 = [];

// Функция для загрузки и парсинга CSV
async function loadHolidaysFromCSV() {
  try {
    const response = await fetch('../templates/holidays.csv');
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

// Экспортируем функцию загрузки и массивы
export { HOLIDAYS_2026, PRE_HOLIDAYS_2026, loadHolidaysFromCSV };
