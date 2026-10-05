// build/report.md 수집기
export class Report {
  constructor() {
    this.sections = new Map();
    this.counts = new Map();
  }

  /** 섹션에 한 줄 추가. 같은 줄은 한 번만 */
  add(section, line) {
    if (!this.sections.has(section)) this.sections.set(section, new Set());
    this.sections.get(section).add(line);
  }

  count(label, n) {
    this.counts.set(label, n);
  }

  get issueCount() {
    let n = 0;
    for (const [name, lines] of this.sections) if (!name.startsWith("참고")) n += lines.size;
    return n;
  }

  toMarkdown() {
    const out = ["# 변환 리포트", "", `생성: ${new Date().toISOString()}`, "", "## 변환 수", "", "| 항목 | 수 |", "|---|---|"];
    for (const [k, v] of this.counts) out.push(`| ${k} | ${v} |`);
    for (const [name, lines] of this.sections) {
      out.push("", `## ${name} (${lines.size})`, "");
      for (const l of lines) out.push(`- ${l}`);
    }
    return out.join("\n") + "\n";
  }
}
