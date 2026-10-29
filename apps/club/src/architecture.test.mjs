import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';

// Module boundaries, checked from real import statements so a violating edit fails CI:
//   domain/              shared contracts; imports nothing else in the app
//   lib/, components/    shared infrastructure; never imports a feature
//   features/<name>/     may use shared code, never another feature
//   worker/              may use domain/ and a feature's pure *.ts modules, never React pages
const root=resolve(import.meta.dirname,'..');
const files=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?files(path):/\.(ts|tsx)$/.test(name)?[path]:[];});
// Normalise to forward slashes once, so the rules below do not depend on the OS path separator.
const rel=path=>relative(root,path).split(sep).join('/');
const area=path=>{const [top,sub,feature]=rel(path).split('/');return top==='src'?(sub==='features'?`feature:${feature}`:sub):top;};
const edges=[...files(join(root,'src')),...files(join(root,'worker'))].flatMap(file=>[...readFileSync(file,'utf8').matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/g)].map(m=>({file,target:resolve(dirname(file),m[1])})));

test('the boundary check sees real imports (guards against a silently empty scan)',()=>{
 assert.ok(edges.length>50);
 assert.ok(edges.some(e=>area(e.file)==='feature:import'&&area(e.target)==='domain'));
});
test('domain contracts and shared modules never depend on a feature',()=>{
 for(const {file,target} of edges){
  const from=area(file),to=area(target);
  if(from==='domain')assert.equal(to,'domain',`${rel(file)} must only import domain/`);
  if(['lib','components'].includes(from))assert.ok(!to.startsWith('feature:'),`${rel(file)} must not import ${rel(target)}`);
 }
});
test('features do not import each other',()=>{
 for(const {file,target} of edges){
  const from=area(file),to=area(target);
  if(from.startsWith('feature:')&&to.startsWith('feature:'))assert.equal(to,from,`${rel(file)} imports another feature: ${rel(target)}`);
 }
});
test('the Worker never imports React components or pages',()=>{
 for(const {file,target} of edges)if(area(file)==='worker'){
  const path=rel(target);
  assert.ok(!path.endsWith('.tsx')&&!path.includes('/components/')&&!path.includes('/app/')&&!/[A-Z]\w*(Page|Dialog)$/.test(path),`${rel(file)} imports UI: ${path}`);
 }
});
// The public landing page (app/page.tsx) is static content, not a feature.
test('route files stay thin: app/ only re-exports a feature page',()=>{
 for(const file of files(join(root,'src/app')).filter(f=>f.endsWith('page.tsx')&&dirname(f)!==join(root,'src/app'))){
  assert.ok(readFileSync(file,'utf8').trim().split('\n').length<=3,`${rel(file)} should only re-export a feature page`);
 }
});
test('no circular imports',()=>{
 const key=path=>rel(path).replace(/\.(ts|tsx)$/,'').replace(/\/index$/,'');
 const graph=new Map();
 for(const {file,target} of edges){const from=key(file);if(!graph.has(from))graph.set(from,new Set());graph.get(from).add(key(target));}
 const state=new Map();
 const visit=(node,path)=>{
  if(state.get(node)==='done')return;
  assert.notEqual(state.get(node),'active',`circular import: ${[...path,node].join(' -> ')}`);
  state.set(node,'active');for(const next of graph.get(node)??[])visit(next,[...path,node]);state.set(node,'done');
 };
 for(const node of graph.keys())visit(node,[]);
});
