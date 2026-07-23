/**
 * Cookie sanitizer types.
 *
 * The data model is intentionally simple and explicit. Cookies flow in
 * from one of two input formats (Netscape, EditThisCookie JSON), are
 * normalised here into a canonical record, and written out as a single
 * standard Netscape file by the writer.
 *
 * Cookie values are NEVER logged anywhere. They live in memory only
 * for the duration of one parse → normalize → write cycle.
 */
export {};
//# sourceMappingURL=types.js.map