// 清理 papers.json 中的错误数据
const fs = require('fs');
const path = require('path');

const papersPath = path.join(__dirname, '..', 'data', 'papers.json');
const papers = JSON.parse(fs.readFileSync(papersPath, 'utf8'));

// 统计清理前
console.log('清理前:', papers.length, '条记录');

// 1. 删除异常日期的记录（2103, 2048等）
const beforeAbnormalDate = papers.length;
const filtered = papers.filter(p => {
  const year = parseInt(p.publishedDate?.substring(0, 4));
  // 保留 2000-2026 之间的记录
  return year >= 2000 && year <= 2026;
});
console.log('删除异常日期:', beforeAbnormalDate - filtered.length, '条');

// 2. 删除期刊匹配明显错误的记录（根据DOI前缀判断）
const beforeWrongJournal = filtered.length;
const knownJournals = {
  'child-development': ['0009', '1467'],  // Child Development ISSN前缀
  'developmental-science': ['1363', '1467'],
  'developmental-psychology': ['0012', '1939'],
  'jecp': ['0022', '1096'],
  'infancy': ['1532'],
  'journal-of-child-language': ['0305'],
  'language-learning-development': ['1547'],
  'journal-of-memory-and-language': ['0749', '1096'],
  'applied-psycholinguistics': ['0142', '1469'],
  'first-language': ['0142']
};

const cleaned = filtered.filter(p => {
  if (!p.doi || !p.journalId) return true; // 保留没有DOI的记录

  // 提取DOI前缀（前4位数字）
  const doiPrefix = p.doi.substring(4, 8);
  const journalPrefixes = knownJournals[p.journalId];

  // 如果期刊有已知的前缀，且DOI前缀不匹配，则删除
  if (journalPrefixes && !journalPrefixes.includes(doiPrefix)) {
    console.log('删除错误匹配:', p.title, 'DOI:', p.doi, '预期期刊:', p.journalId);
    return false;
  }
  return true;
});

console.log('删除错误期刊匹配:', beforeWrongJournal - cleaned.length, '条');

// 3. 删除没有摘要的非研究记录
const beforeNoAbstract = cleaned.length;
const final = cleaned.filter(p => {
  // 保留有摘要或状态为demo的记录
  return p.abstractEn && !p.abstractEn.toLowerCase().includes('not available') && !p.abstractEn.includes('摘要未');
});
console.log('删除无摘要记录:', beforeNoAbstract - final.length, '条');

console.log('清理后:', final.length, '条记录');

// 保存清理后的数据
fs.writeFileSync(papersPath, JSON.stringify(final, null, 2) + '\n');
console.log('已保存到 papers.json');
