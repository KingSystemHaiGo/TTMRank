export async function waitForAssets(root=document){
  const images=[...(root.images || root.querySelectorAll?.('img') || [])];
  images.forEach(image=>{image.loading='eager';});
  await Promise.all(images.map(image=>image.complete?Promise.resolve():Promise.race([
    new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});}),
    new Promise(resolve=>setTimeout(resolve,3000)),
  ])));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
export async function exportLongImage(){
  const root=arguments[0]||document.querySelector('main');
  if(!window.html2canvas){window.alert('长图组件加载失败，请检查网络后重试，或使用导出 PDF。');return;}
  await waitForAssets(root);
  const wasReport=document.body.classList.contains('report-mode'); document.body.classList.add('report-mode');
  const button=document.getElementById('imageBtn'); const original=button?.textContent; if(button){button.disabled=true;button.textContent='生成中…';}
  try{
    const canvas=await window.html2canvas(root,{backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),scale:1,useCORS:true,allowTaint:false,logging:false,windowWidth:Math.max(1100,document.documentElement.scrollWidth)});
    const maxHeight=14000; const parts=Math.ceil(canvas.height/maxHeight); const stamp=new Date().toISOString().slice(0,10);
    for(let index=0;index<parts;index++){
      const height=Math.min(maxHeight,canvas.height-index*maxHeight); const part=document.createElement('canvas'); part.width=canvas.width;part.height=height;part.getContext('2d').drawImage(canvas,0,index*maxHeight,canvas.width,height,0,0,canvas.width,height);
      const blob=await new Promise(resolve=>part.toBlob(resolve,'image/png')); const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`TTMRank-分析报告-${stamp}-${index+1}of${parts}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    }
  }finally{if(!wasReport)document.body.classList.remove('report-mode');if(button){button.disabled=false;button.textContent=original;}}
}
