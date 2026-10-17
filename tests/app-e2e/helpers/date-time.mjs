// FORM-시간입력: a date-time field is a date picker plus a 4-digit time cell (#idDate, #idTime).
// Type the time as digits, the way a phone user does, and leave the cell so it is tidied to HH:MM.
export async function fillDateTime(page,selector,value){
  const [date,time='']=String(value).split('T');
  await page.locator(selector+'Date').fill(date);
  const cell=page.locator(selector+'Time');
  await cell.fill(time.replace(':',''));await cell.blur();
}
