import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { zipSync, strToU8 } from 'fflate';
import { statisticTables } from './statistics.mjs';
const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
// Small, standards-based OOXML writer. All user text is stored as text, never formulas.
export function excelBytes(stats) {
 return workbookBytes(statisticTables(stats));
}
export function workbookBytes(tables) {
 const files={};
 const put=(path,s)=>files[path]=strToU8(s);
 put('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
 put('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 put('xl/workbook.xml',`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables.map((t,i)=>`<sheet name="${xml(t.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
 put('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
 put('xl/styles.xml','<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF11334D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
 tables.forEach((t,i)=>{
  const width=Math.max(...t.rows.map(r=>r.length));
  put(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${Array.from({length:width},(_,j)=>`<col min="${j+1}" max="${j+1}" width="${j===0?38:j===3?48:22}" customWidth="1"/>`).join('')}</cols><sheetData>${t.rows.map((r,ri)=>`<row r="${ri+1}" ht="${ri===0?36:48}" customHeight="1">${r.map((v,j)=>{const ref=`${col(j)}${ri+1}`,style=ri===0?1:0;return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}" s="${style}"><v>${v}</v></c>`:`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData>${i>0?`<autoFilter ref="A1:${col(width-1)}${t.rows.length}"/>`:''}</worksheet>`);
 });
 return zipSync(files,{level:6});
}
export async function textPDF(title, sections, fontBytes) {
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(fontBytes,{subset:true});
 let page, y;const width=499;
 const newPage=()=>{page=doc.addPage([595.28,841.89]);y=782;page.drawRectangle({x:0,y:811,width:596,height:31,color:rgb(.067,.2,.3)});};
 const line=(text,size=10,color=rgb(.09,.18,.26))=>{if(y<55)newPage();page.drawText(text,{x:48,y,size,font,color});y-=size+6;};
 const supported=new Set(font.getCharacterSet());
 const printable=text=>Array.from(String(text??'')).map(c=>c==='\n'||c==='\r'||c==='\t'||supported.has(c.codePointAt(0))?c:`[U+${c.codePointAt(0).toString(16).toUpperCase()}]`).join('');
 const wrap=(text,size)=>{
  for(const raw of printable(text).split(/\r?\n/)) {
   let current='';
   for(const word of raw.replace(/\t/g,'    ').split(' ')) {
    if(current && font.widthOfTextAtSize(current+' '+word,size)>width){line(current,size);current='';}
    if(font.widthOfTextAtSize(word,size)>width){
     if(current){line(current,size);current='';}
     for(const c of word){if(current && font.widthOfTextAtSize(current+c,size)>width){line(current,size);current='';}current+=c;}
    } else current+=(current?' ':'')+word;
   }
   line(current,size);
  }
 };
 newPage();wrap(title,19);y-=8;
 for(const section of sections){
  if(y<(section.chart?310:100))newPage();wrap(section.title,12);
  for(const text of section.lines||[])wrap(text,10);
  if(section.chart){
   const left=80,bottom=y-160,w=450,h=125,years=section.years;
   for(let n=0;n<=100;n+=25){const yy=bottom+n*h/100;page.drawLine({start:{x:left,y:yy},end:{x:left+w,y:yy},thickness:.4,color:rgb(.8,.85,.88)});page.drawText(n+'%',{x:48,y:yy-3,size:8,font});}
   let previous=null;
   years.forEach((year,i)=>{
    const x=years.length===1?left+w/2:left+i*w/(years.length-1),r=section.chart.find(r=>r.year===year.year);
    const labelStep=Math.max(1,Math.ceil(years.length/9));
    if(i%labelStep===0)page.drawText(year.year,{x:x-10,y:bottom-16,size:8,font});
    if(!r||r.concernPct===null){previous=null;return;}
    const yy=bottom+r.concernPct*h/100;
    if(previous)page.drawLine({start:previous,end:{x,y:yy},thickness:1.5,color:rgb(.09,.29,.42)});
    page.drawCircle({x,y:yy,size:2.5,color:rgb(.09,.29,.42)});
    if(years.length<=9){page.drawText(r.concernPct.toFixed(1)+'%',{x:x-12,y:yy+8,size:8,font});page.drawText('n='+r.assessed,{x:x-12,y:bottom-29,size:7,font});}
    previous={x,y:yy};
   });y=bottom-45;
  }
  y-=10;
 }
 const pages=doc.getPages();pages.forEach((p,i)=>{p.drawText(`BSI working prototype | Page ${i+1} of ${pages.length}`,{x:48,y:27,size:8,font,color:rgb(.32,.4,.47)});});
 doc.setTitle(title);doc.setProducer('BSI Digital Judge Report');return doc.save();
}
export function reportSections(p,id='Draft') {
 return [
  {title:'Report identification',lines:[`Report ID: ${id}`,`BSI version: ${p.bsiVersion||'Legacy / not recorded'}`,`Organising club: ${p.organisingClub?.name||'Not recorded (historical report)'}`,`Club type: ${p.organisingClub?.type||'Not recorded'} | Ring: ${p.ring||'Not recorded'}`,`Show: ${p.show}`,`Date: ${p.date} | Country: ${p.country}`,`Judge: ${p.judge}`,`Breed: ${p.breed} | ${p.group}`,`Dogs judged: ${p.total} (judging observations, not unique dogs)`]},
  ...p.risks.map(r=>({title:r.risk,lines:[`No observed concerns: ${r.none} | Mild: ${r.mild} | Clear: ${r.clear}`,`Severe: ${r.severe} | Not assessed: ${r.na}`]})),
  {title:'Other observed concerns',lines:p.other.length?p.other.map(o=>`${o.problem} | Number affected: ${o.count}`):['None recorded']},
  {title:'Positive observations',lines:[p.positive||'None recorded']},
  {title:'Impact on judging',lines:[`Quality grading affected: ${p.quality}`,`Placing affected: ${p.placing}`,'These counts may include the same dogs.']},
  {title:'Additional comments',lines:[p.comments||'None recorded']},
  {title:'Report status',lines:['Working BSI summaries. Not an official FCI form or veterinary diagnosis. All recipients receive the same saved report content. Characters unavailable in the embedded font are represented by their Unicode code points.']}
 ];
}
export async function reportPDF(p,id,font){return textPDF('BSI - Digital Judge Report',reportSections(p,id),font);}
export async function statisticsPDF(s,font) {
 const fmt=x=>x===null?'Not available':Number(x).toFixed(1);
 return textPDF('BSI - Breed monitoring statistics',[
  {title:'Selection and method',lines:[`${s.filters.start} to ${s.filters.end}`,`Breed: ${s.filters.breed||'All breeds'}`,`Reports: ${s.summary.reports} | Shows: ${s.summary.shows} | Judging observations: ${s.summary.dogs}`,s.definitions]},
  {title:'Data coverage',lines:s.years.map(y=>`${y.year}: ${y.reports} reports${!y.reports?' - no data':''}`)},
  ...[...new Set(s.areas.map(r=>JSON.stringify([r.breed,r.version,r.risk])))].map(key=>{const [breed,version,risk]=JSON.parse(key);return {title:`${breed}: ${risk}`,lines:[`Version: ${version} | Concern % among assessed observations`],chart:s.areas.filter(r=>r.breed===breed&&r.version===version&&r.risk===risk),years:s.years};}),
  ...s.annual.map(t=>({title:`${t.breed} - ${t.year} - ${t.version}`,lines:[`Reports: ${t.reports} | Shows: ${t.shows} | Dogs judged: ${t.dogs}`,`Quality grading affected: ${t.quality} (${fmt(t.qualityPct)}%) | Placing affected: ${t.placing} (${fmt(t.placingPct)}%)`]})),
  ...s.areas.map(r=>({title:`${r.breed} - ${r.year}: ${r.risk}`,lines:[`Version: ${r.version} | Reports: ${r.reports} | Assessed: ${r.assessed}`,`No concerns: ${r.none} (${fmt(r.nonePct)}%) | Mild: ${r.mild} (${fmt(r.mildPct)}%)`,`Clear: ${r.clear} (${fmt(r.clearPct)}%) | Severe: ${r.severe} (${fmt(r.severePct)}%)`,`Not assessed: ${r.na} | With concerns: ${r.concerns} (${fmt(r.concernPct)}%)`,`Change: ${fmt(r.changePP)} percentage points | Relative change: ${fmt(r.relativeChangePct)}%`,r.trend]})),
  ...s.observations.map(o=>({title:`Other observations: ${o.breed}, ${o.date} (${o.id})`,lines:[`Positive: ${o.positive||'None recorded'}`,...o.other.map(r=>`${r.problem} | Count: ${r.count}`)]}))
 ],font);
}
