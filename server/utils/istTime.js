/**
 * VideoVerse — IST (Indian Standard Time) Theme Calculator
 *
 * Rule:
 *   Light Theme: 05:00:00 AM inclusive to 12:00:00 PM exclusive IST
 *   Dark Theme:  12:00:00 PM inclusive to 05:00:00 AM exclusive IST
 *
 * IST is UTC+05:30.
 */

/**
 * Returns the current hour and minute in Indian Standard Time (IST).
 * @param {Date|number} [date=new Date()]
 * @returns {{ hour: number, minute: number, totalMinutes: number }}
 */
function getIstTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  // IST is exactly UTC + 5 hours 30 minutes
  const utcMillis = d.getTime() + d.getTimezoneOffset() * 60000;
  const istMillis = utcMillis + (5.5 * 3600000);
  const istDate = new Date(istMillis);

  const hour = istDate.getHours();
  const minute = istDate.getMinutes();
  const totalMinutes = hour * 60 + minute;

  return { hour, minute, totalMinutes, istDate };
}

/**
 * Determines whether the given date/time falls into the Light Theme window in IST.
 * 05:00 inclusive (300 minutes) to 12:00 exclusive (720 minutes).
 *
 * @param {Date|number} [date=new Date()]
 * @returns {'light'|'dark'}
 */
function getAutoIstTheme(date = new Date()) {
  const { totalMinutes } = getIstTime(date);
  const startMinutes = 5 * 60;  // 05:00 AM IST = 300 min
  const endMinutes = 12 * 60;   // 12:00 PM IST = 720 min

  if (totalMinutes >= startMinutes && totalMinutes < endMinutes) {
    return 'light';
  }
  return 'dark';
}

/**
 * Resolves the final active theme given a user's stored preference.
 *
 * @param {string} [themePreference='auto'] - 'auto', 'light', 'dark', or legacy 'system'
 * @param {Date|number} [date=new Date()]
 * @returns {'light'|'dark'}
 */
function resolveTheme(themePreference = 'auto', date = new Date()) {
  if (themePreference === 'light') return 'light';
  if (themePreference === 'dark') return 'dark';
  // 'auto' or 'system' falls back to IST time-based automatic theme
  return getAutoIstTheme(date);
}

module.exports = {
  getIstTime,
  getAutoIstTheme,
  resolveTheme,
};
