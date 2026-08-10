"use strict";
const $=id=>document.getElementById(id),DB="cozy-reader",STORE="books";
let db,books=[],active=null,book=null,rendition=null,textPage=0,textPages=1,mediaUrl=null,touchX=0;
let fontSize=Number(localStorage.getItem("cozy-font-size")||1.16),appearance=localStorage.getItem("cozy-appearance")||"light";

function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2500)}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:"id"});req.onsuccess=()=>{db=req.result;resolve()};req.onerror=()=>reject(req.error)})}
function all(){return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
function change(mode,action){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);action(tx.objectStore(STORE));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}

function ext(name){return(name.split(".").pop()||"").toLowerCase()}
function kind(file){const e=ext(file.name);if(e==="epub")return"epub";if(["txt","text","md","markdown"].includes(e))return"text";if(file.type.startsWith("audio/")||["mp3","m4a","wav","ogg","flac","opus"].includes(e))return"audio";if(file.type.startsWith("video/")||["mp4","m4v","webm","mov","ogv"].includes(e))return"video";return""}
function label(type){return({epub:"EPUB BOOK",text:"TEXT BOOK",audio:"AUDIO",video:"VIDEO"})[type]||"FILE"}
function glyph(type){return({epub:"❦",text:"¶",audio:"♫",video:"▶"})[type]||"□"}
function bytes(n){return n<1048576?`${Math.ceil(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`}

async function refresh(){books=await all();renderShelf()}

function renderShelf(){
  const holder=$("books"),q=$("search").value.trim().toLowerCase();
  holder.replaceChildren();
  const shown=books.filter(item=>item.name.toLowerCase().includes(q)).sort((a,b)=>b.added-a.added);
  $("status").textContent=shown.length?`${shown.length} item${shown.length===1?"":"s"} on your shelf.`:"Your shelf is waiting for its first story.";
  for(const item of shown){
    const card=$("book").content.firstElementChild.cloneNode(true);
    card.dataset.kind=item.kind;
    card.querySelector(".spine").textContent=glyph(item.kind);
    card.querySelector(".kind").textContent=label(item.kind);
    card.querySelector("h3").textContent=item.name;
    card.querySelector(".meta").textContent=bytes(item.size);
    card.onclick=()=>openItem(item);
    card.querySelector(".delete").onclick=async event=>{event.stopPropagation();if(confirm(`Remove “${item.name}” from this device?`)){await change("readwrite",store=>store.delete(item.id));await refresh();toast("Removed from the shelf.")}};
    holder.append(card);
  }
}

async function importFiles(files){
  const accepted=[...files].filter(file=>kind(file));
  if(!accepted.length)return toast("Choose EPUB, text, audio, or video files.");
  try{
    for(const file of accepted){
      const saved={id:crypto.randomUUID(),name:file.name,kind:kind(file),type:file.type,data:await file.arrayBuffer(),size:file.size,added:Date.now()};
      await change("readwrite",store=>store.put(saved));
    }
    await refresh();
    toast(`${accepted.length} item${accepted.length===1?"":"s"} added.`);
  }catch(error){console.error(error);toast("This device could not save those files.")}
}

function clearEpub(){if(rendition){try{rendition.destroy()}catch(e){}rendition=null}if(book){try{book.destroy()}catch(e){}book=null}$("epubStage").replaceChildren()}

function applyAppearance(){
  const reader=$("reader");
  reader.classList.toggle("night",appearance==="night");
  reader.classList.toggle("sepia",appearance==="sepia");
  reader.style.setProperty("--size",`${fontSize}rem`);
  if(rendition){
    rendition.themes.fontSize(`${fontSize}em`);
    rendition.themes.default({"body":{"overflow-wrap":"anywhere","word-break":"break-word","hyphens":"auto","padding":"0 !important"},"p,h1,h2,h3,h4,h5,h6":{"overflow-wrap":"anywhere","word-break":"break-word"}});
    rendition.themes.override("color",getComputedStyle(reader).getPropertyValue("--ink"));
    rendition.themes.override("background",getComputedStyle(reader).getPropertyValue("--bg"));
    rendition.resize();
  }
}

function updatePageStatus(){if(rendition){$("pageStatus").textContent="Use Previous and Next";return}$("pageStatus").textContent=`Page ${textPage+1} of ${textPages}`}

function paginateText(keepProgress=true){
  if(!active||active.kind!=="text")return;
  const article=$("textContent"),area=$("content"),ratio=keepProgress&&textPages>1?textPage/(textPages-1):0;
  article.style.columnWidth=`${area.clientWidth}px`;
  article.style.columnGap="0px";
  textPages=Math.max(1,Math.round(article.scrollWidth/area.clientWidth));
  textPage=Math.max(0,Math.min(textPages-1,Math.round(ratio*(textPages-1))));
  showTextPage(textPage,false);
}

function showTextPage(index,save=true){
  textPage=Math.max(0,Math.min(textPages-1,index));
  $("textContent").style.transform=`translateX(${-textPage*$("content").clientWidth}px)`;
  if(save&&active)localStorage.setItem(`cozy-progress-${active.id}`,String(textPage/(textPages-1||1)));
  updatePageStatus();
}

function openText(item){
  const article=$("textContent");
  article.hidden=false;
  article.textContent=new TextDecoder().decode(item.data);
  requestAnimationFrame(()=>{paginateText(false);const saved=Number(localStorage.getItem(`cozy-progress-${item.id}`)||0);showTextPage(Math.round(saved*(textPages-1)),false)});
}

async function openEpub(item){
  try{
    book=ePub(item.data.slice(0));
    rendition=book.renderTo("epubStage",{width:"100%",height:"100%",flow:"paginated",spread:"none",allowScriptedContent:false});
    $("epubStage").hidden=false;
    rendition.on("relocated",location=>{if(location.start&&location.start.cfi)localStorage.setItem(`cozy-progress-${active.id}`,location.start.cfi);updatePageStatus()});
    await rendition.display(localStorage.getItem(`cozy-progress-${item.id}`)||undefined);
    applyAppearance();
    const nav=await book.loaded.navigation;
    renderToc(nav.toc||[]);
    updatePageStatus();
  }catch(error){console.error(error);toast("This EPUB could not be opened.");closeReader()}
}

function renderToc(entries){
  const holder=$("tocItems");
  holder.replaceChildren();
  if(!entries.length){holder.textContent="No chapter list is available for this book.";return}
  for(const entry of entries){
    const button=document.createElement("button");
    button.textContent=entry.label||"Untitled chapter";
    button.onclick=()=>{rendition.display(entry.href);$("toc").hidden=true};
    holder.append(button);
  }
}

function openItem(item){
  if(item.kind==="audio"||item.kind==="video"){openPlayer(item);return}
  active=item;
  $("title").textContent=item.name;
  $("library").hidden=true;
  $("reader").hidden=false;
  $("toc").hidden=true;
  $("textContent").hidden=true;
  $("epubStage").hidden=true;
  clearEpub();
  applyAppearance();
  if(item.kind==="text")openText(item);else openEpub(item);
}

function closeReader(){clearEpub();active=null;$("reader").hidden=true;$("library").hidden=false}
function goPrevious(){if(rendition)rendition.prev();else showTextPage(textPage-1)}
function goNext(){if(rendition)rendition.next();else showTextPage(textPage+1)}

function openPlayer(item){
  const media=$("media");
  closePlayer();
  mediaUrl=URL.createObjectURL(new Blob([item.data],{type:item.type||(item.kind==="audio"?"audio/mpeg":"video/mp4")}));
  media.src=mediaUrl;
  media.hidden=false;
  $("mediaTitle").textContent=item.name;
  $("player").hidden=false;
  media.play().catch(()=>{});
}
function closePlayer(){
  const media=$("media");
  media.pause();
  media.removeAttribute("src");
  media.load();
  if(mediaUrl){URL.revokeObjectURL(mediaUrl);mediaUrl=null}
  $("player").hidden=true;
}

$("files").onchange=event=>{importFiles(event.target.files);event.target.value=""};
$("search").oninput=renderShelf;
$("back").onclick=closeReader;
$("previous").onclick=goPrevious;
$("next").onclick=goNext;
$("chapters").onclick=()=>$("toc").hidden=!$("toc").hidden;
$("closeToc").onclick=()=>$("toc").hidden=true;
$("closePlayer").onclick=closePlayer;
$("smaller").onclick=()=>{fontSize=Math.max(.85,+(fontSize-.1).toFixed(2));localStorage.setItem("cozy-font-size",fontSize);applyAppearance();paginateText()};
$("larger").onclick=()=>{fontSize=Math.min(1.8,+(fontSize+.1).toFixed(2));localStorage.setItem("cozy-font-size",fontSize);applyAppearance();paginateText()};
$("appearance").onclick=()=>{appearance={light:"sepia",sepia:"night",night:"light"}[appearance];localStorage.setItem("cozy-appearance",appearance);applyAppearance();paginateText()};

document.addEventListener("keydown",event=>{
  if($("reader").hidden||event.target.matches("input,textarea,button"))return;
  if(event.key==="ArrowRight"||event.key==="PageDown"||event.key===" "){event.preventDefault();goNext()}
  if(event.key==="ArrowLeft"||event.key==="PageUp"){event.preventDefault();goPrevious()}
  if(event.key==="Escape")closeReader();
});
$("content").addEventListener("pointerdown",event=>{touchX=event.clientX});
$("content").addEventListener("pointerup",event=>{
  const dx=event.clientX-touchX;
  if(Math.abs(dx)>45){dx<0?goNext():goPrevious()}
  else if(event.target===$("content")){event.clientX<innerWidth*.35?goPrevious():event.clientX>innerWidth*.65?goNext():null}
});
window.addEventListener("resize",()=>{if(rendition)rendition.resize();paginateText()});

if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(console.warn));
openDb().then(refresh).catch(error=>{console.error(error);$("status").textContent="Local storage is unavailable in this browser."});