// Used by the mobile shell and workspace specs, both with Asia/Seoul contexts.
export async function calendarToday(page) {
  // Use the browser's local date, just like the calendar, rather than Node's UTC date.
  const { today, noon } = await page.evaluate(() => {
    const date = new Date();
    const pad = value => String(value).padStart(2, '0');
    const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    date.setHours(12, 0, 0, 0);
    return { today, noon: date.getTime() };
  });
  // Start at noon on that same day so crossing midnight cannot split setup and
  // rendering. Keep time advancing: swipe click suppression relies on Date.now().
  await page.clock.install({ time: new Date(noon) });
  return today;
}
