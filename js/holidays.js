// Праздничные дни 2026 из holidays.csv
const holidaysCSV = `date,type
2026-01-01,holiday
2026-01-02,holiday
2026-01-03,holiday
2026-01-04,holiday
2026-01-05,holiday
2026-01-06,holiday
2026-01-07,holiday
2026-01-08,holiday
2026-01-09,holiday
2026-01-10,holiday
2026-01-11,holiday
2026-02-23,holiday
2026-03-08,holiday
2026-05-01,holiday
2026-05-09,holiday
2026-06-12,holiday
2026-11-04,holiday
2026-12-31,holiday
2026-04-30,preholiday
2026-05-08,preholiday
2026-06-11,preholiday
2026-11-03,preholiday`;

function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const data = lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index];
      return obj;
    }, {});
  });
  return data;
}

const holidaysData = parseCSV(holidaysCSV);

export const HOLIDAYS_2026 = holidaysData.filter(d => d.type === 'holiday').map(d => d.date);
export const PRE_HOLIDAYS_2026 = holidaysData.filter(d => d.type === 'preholiday').map(d => d.date);
