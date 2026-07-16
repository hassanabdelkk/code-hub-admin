// Minimaler ICS-Generator (RFC 5545) für Bewerbungsgespräche.
// Kein NPM-Paket nötig.

function pad(n: number) { return n.toString().padStart(2, "0"); }

function fmtUtc(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  // ICS-Zeilen dürfen max. 75 Bytes lang sein; längere per CRLF+Space folden.
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
  return parts.join("\r\n");
}

export interface IcsEventInput {
  uid: string;              // stabile ID (z.B. appointment id + domain)
  title: string;
  description?: string;
  start: Date;
  end: Date;
  url?: string;
  organizerName?: string;
  organizerEmail?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  status?: "CONFIRMED" | "CANCELLED";
}

export function buildIcs(evt: IcsEventInput): string {
  const now = fmtUtc(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MB Portal//Bewerbungsgespraech//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${evt.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${fmtUtc(evt.start)}`,
    `DTEND:${fmtUtc(evt.end)}`,
    `SUMMARY:${escapeText(evt.title)}`,
    `STATUS:${evt.status ?? "CONFIRMED"}`,
    "TRANSP:OPAQUE",
  ];
  if (evt.description) lines.push(`DESCRIPTION:${escapeText(evt.description)}`);
  if (evt.url) lines.push(`URL:${evt.url}`);
  if (evt.organizerEmail) {
    lines.push(`ORGANIZER;CN=${escapeText(evt.organizerName || evt.organizerEmail)}:mailto:${evt.organizerEmail}`);
  }
  if (evt.attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${escapeText(evt.attendeeName || evt.attendeeEmail)};RSVP=TRUE:mailto:${evt.attendeeEmail}`,
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}

export function icsDataUrl(ics: string): string {
  const b64 = typeof btoa !== "undefined"
    ? btoa(unescape(encodeURIComponent(ics)))
    : Buffer.from(ics, "utf-8").toString("base64");
  return `data:text/calendar;charset=utf-8;base64,${b64}`;
}
