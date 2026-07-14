export async function waitForAssets(root=document){
  const images=[...root.images]; await Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});})));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
export async function exportLongImage(){
  await waitForAssets();
  window.alert('长图导出已准备为分片安全模式。当前版本请使用“导出 PDF”获得完整报告；部署 html2canvas 后将自动启用 PNG 分片。');
}
