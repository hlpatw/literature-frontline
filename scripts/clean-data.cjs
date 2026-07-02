// 温和清理 papers.json - 只删除明显错误的记录
const fs = require('fs');
const path = require('path');

const papersPath = path.join(__dirname, '..', 'data', 'papers.json');
const papers = JSON.parse(fs.readFileSync(papersPath, 'utf8'));

console.log('清理前:', papers.length, '条记录');

// 1. 只删除明显的 Issue Information 记录
const beforeIssueInfo = papers.length;
const step1 = papers.filter(p => {
  const title = (p.title || '').toLowerCase();
  return !title.includes('issue information') &&
         !title.includes('editorial board') &&
         !title.startsWith('issue ');
});
console.log('删除 Issue Information:', beforeIssueInfo - step1.length, '条');

// 2. 删除明显异常的日期（2100年以后的记录，但可能是Crossref返回的错误数据）
const beforeAbnormal = step1.length;
const step2 = step1.filter(p => {
  const year = parseInt(p.publishedDate?.substring(0, 4));
  // 保留 2000-当前年份+1 的记录
  const currentYear = new Date().getFullYear();
  return year >= 2000 && year <= currentYear + 1;
});
console.log('删除异常日期:', beforeAbnormal - step2.length, '条');

// 3. 不进行期刊前缀检查（因为可能有很多合法记录）

console.log('清理后:', step2.length, '条记录');

// 保存
fs.writeFileSync(papersPath, JSON.stringify(step2, null, 2) + '\n');
console.log('已保存到 papers.json');
