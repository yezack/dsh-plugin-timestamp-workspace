import { apply, formatTimestamp } from '../lib/client.mjs';
const calls=[];
const ctx={workspaces:{pickDirectory:async()=>null,createDirectory:async(root,name)=>{calls.push({root,name});return root+'/'+name}},slots:{inject:(name,fn)=>{calls.push({kind:'inject',name});const nested=fn();if(nested?.next){const iterator=nested;let step;while(!(step=iterator.next()).done){calls.push({kind:'register',options:step.value.options,component:typeof step.value.component});}}},register:(options,component)=>({options,component})}};
apply(ctx,{rootDirectory:'C:/tmp/workspaces'});
console.log(JSON.stringify({timestamp:formatTimestamp(new Date(2026,2,8,5,6,7)),calls}));