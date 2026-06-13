export const DANGEROUS_PHRASES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /remove\s+(the\s+)?fuel\s+rail/i, reason: "fuel rail removal" },
  { pattern: /disable\s+(the\s+)?airbag/i, reason: "airbag disable" },
  { pattern: /bypass\s+(the\s+)?airbag/i, reason: "airbag bypass" },
  { pattern: /jack\s+only/i, reason: "unsafe jacking" },
  { pattern: /under\s+running\s+engine/i, reason: "work under running engine" },
  { pattern: /depressurize\s+fuel/i, reason: "fuel depressurization" },
  { pattern: /spring\s+compressor/i, reason: "strut/spring disassembly" },
  { pattern: /strut\s+disassembl/i, reason: "strut disassembly" },
  { pattern: /bleed\s+(the\s+)?brake/i, reason: "brake bleeding without pro guidance" },
  { pattern: /orange\s+cable/i, reason: "EV high voltage cable" },
  { pattern: /srs\s+(module|work)/i, reason: "SRS work" },
  { pattern: /unsupported\s+vehicle/i, reason: "unsupported vehicle work" },
  { pattern: /crawl\s+under.*jack/i, reason: "under unsupported vehicle" },
  { pattern: /starting\s+fluid.*intake/i, reason: "starting fluid in intake" },
  { pattern: /wire\s+around\s+airbag/i, reason: "airbag tampering" },
  { pattern: /tamper\s+with\s+odometer/i, reason: "odometer tampering" },
];

export const EV_HYBRID_KEYWORDS = [
  "tesla",
  "leaf",
  "bolt ev",
  "hybrid battery",
  "high voltage",
  "orange cable",
  "400v",
  "800v",
  "ev battery",
  "plug-in hybrid",
  "phev",
];

export const BYPASS_KEYWORDS = [
  "bypass airbag",
  "disable airbag",
  "turn off airbag",
  "airbag light hack",
  "delete dpf",
  "egr delete",
  "emissions delete",
];
