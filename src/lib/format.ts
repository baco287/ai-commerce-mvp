// Formatierung immer für de-DE und Europe/Berlin – identisch auf Server und Client.

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const rating = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });

export const formatEur = (v: number) => eur.format(v);
export const formatEur0 = (v: number) => eur0.format(v);
export const formatPercent = (v: number) => pct.format(v);
export const formatRating = (v: number) => rating.format(v);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatDayMonth = (isoDay: string) => dayMonth.format(new Date(`${isoDay}T12:00:00Z`));
export const formatDays = (min: number, max: number) => (min === max ? `${min} Tage` : `${min}–${max} Tage`);
