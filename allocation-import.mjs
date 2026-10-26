import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {identifyBreed,normalise} from './clubs.mjs';
const limit=2*1024*1024;
export function parseCSV(text){
 if(new TextEncoder().encode(text).length>limit)throw new Error('CSV files must be 2 MB or smaller.');
 text=text.replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/)[0],delimiter=['\t',';',','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[];let row=[],cell='',quoted=false,afterQuote=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=ch;continue;}
  if(ch==='"'&&!cell&&!afterQuote){quoted=true;continue;}
  if(ch===delimiter){row.push(cell);cell='';afterQuote=false;continue;}
  if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell='';afterQuote=false;continue;}
  if(afterQuote&&ch.trim())throw new Error('Invalid CSV quoting. Export a standard UTF-8 CSV file.');
  cell+=ch;
 }
 if(quoted)throw new Error('The CSV file contains an unclosed quoted field.');
 row.push(cell);if(row.some(c=>c.trim()))rows.push(row);
 if(rows.length>2001)throw new Error('Use at most 2,000 allocation rows plus a header.');return rows;
}
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true,isArray:name=>['sheet','Relationship','row','c','si','r'].includes(name)});
function xml(bytes){const text=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('XML document types and custom entities are not allowed.');return parser.parse(text,true);}
const asArray=v=>v===undefined?[]:Array.isArray(v)?v:[v];
function textValue(node){if(node===undefined||node===null)return '';if(typeof node!=='object')return String(node);if(node.t!==undefined)return textValue(node.t);if(node.r)return asArray(node.r).map(textValue).join('');return node['#text']!==undefined?String(node['#text']):'';}
export function parseXLSX(bytes){
 if(bytes.length>limit)throw new Error('Excel files must be 2 MB or smaller.');
 let size=0,entries=0;
 const allowed=name=>/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name);
 const zip=unzipSync(bytes,{filter:file=>{
  if(++entries>2000)throw new Error('Too many workbook archive entries.');
  if(!allowed(file.name))return false;
  size+=file.originalSize;
  if(file.originalSize>5*1024*1024||size>10*1024*1024)throw new Error('The workbook expands beyond the import size limit.');return true;
 }});
 if(!zip['xl/workbook.xml']||!zip['xl/_rels/workbook.xml.rels'])throw new Error('This is not a supported .xlsx workbook.');
 const workbook=xml(zip['xl/workbook.xml']),rels=xml(zip['xl/_rels/workbook.xml.rels']);
 const shared=zip['xl/sharedStrings.xml']?asArray(xml(zip['xl/sharedStrings.xml']).sst?.si).map(textValue):[];
 const relationship=new Map(asArray(rels.Relationships?.Relationship).filter(r=>r['@_TargetMode']!=='External').map(r=>[r['@_Id'],r['@_Target']]));
 return asArray(workbook.workbook?.sheets?.sheet).map(sheet=>{
  let path=relationship.get(sheet['@_r:id'])||'';path=path.startsWith('/')?path.slice(1):'xl/'+path;
  if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)||!zip[path])throw new Error('Unsupported worksheet relationship.');
  const source=xml(zip[path]),rows=[];
  for(const row of asArray(source.worksheet?.sheetData?.row)){
   const cells=[];
   for(const cell of asArray(row.c)){
    const ref=cell['@_r']||'',match=/^([A-Z]+)\d+$/.exec(ref);if(!match)throw new Error('A cell has an invalid worksheet reference.');
    let index=0;for(const letter of match[1])index=index*26+letter.charCodeAt(0)-64;index--;
    if(index>99)throw new Error('Use a simple import worksheet with at most 100 columns.');
    if(cell.f!==undefined)throw new Error('Formula cells are not accepted. Paste values into the allocation worksheet first.');
    const value=cell['@_t']==='s'?shared[Number(cell.v)]:cell['@_t']==='inlineStr'?textValue(cell.is):String(cell.v??'');cells[index]=value||'';
   }
   if(cells.some(c=>String(c).trim()))rows.push(cells);
   if(rows.length>2001)throw new Error('Use at most 2,000 allocation rows plus a header.');
  }
  return {name:sheet['@_name'],rows};
 });
}
export function allocationPreview(matrix){
 if(!matrix.length)throw new Error('The file is empty.');
 const normal=s=>normalise(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
 const header=matrix[0].map(normal),aliases={ring:['ring','ringnumber','ringnr','ringnummer'],judge:['judge','judgename','domare'],breed:['breed','breedname','ras']};
 const indexes=Object.fromEntries(Object.entries(aliases).map(([k,names])=>[k,header.findIndex(h=>names.includes(h))]));
 if(Object.values(indexes).some(i=>i<0))throw new Error('Required column headers: Ring, Judge, Breed. Use one breed per row.');
 return matrix.slice(1).map((values,i)=>{
  const row=Object.fromEntries(Object.entries(indexes).map(([k,index])=>[k,String(values[index]??'').trim()]));
  if(!row.ring||!row.judge||!row.breed)throw new Error(`Row ${i+2}: ring, judge and breed must not be blank.`);
  const known=identifyBreed(row.breed);return {...row,sourceBreed:row.breed,breed:known||row.breed,recognised:Boolean(known),confirmedUnlisted:false};
 });
}
