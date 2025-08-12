// ---------- Setup básico ----------
  const container = document.getElementById('canvas-wrap');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f2f4);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 5000);
  camera.position.set(400, 260, 420);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio ? window.devicePixelRatio : 1);
  renderer.shadowMap.enabled = true; // Ativar sombras
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Sombras suaves
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 40, 0);
  controls.update();

  // Luzes - configuradas para sombras
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  hemi.position.set(0, 200, 0);
  scene.add(hemi);
  
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(300, 400, 200);
  dir.castShadow = true;
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 2000;
  dir.shadow.camera.left = -500;
  dir.shadow.camera.right = 500;
  dir.shadow.camera.top = 500;
  dir.shadow.camera.bottom = -500;
  dir.shadow.mapSize.width = 1024;
  dir.shadow.mapSize.height = 1024;
  scene.add(dir);

  // Adicionar luz ambiente para melhor iluminação
  const ambient = new THREE.AmbientLight(0x404040);
  scene.add(ambient);

  // Chao suave
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000), 
    new THREE.MeshStandardMaterial({ color: 0xf6f6f6 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);

  // Estado
  let boxMesh = null;
  let faceMaterials = [];
  let currentFaceTextureCanvas = {}; // store canvas per face for redraws
  let currentTextureImage = null;
  let wireframe = false;

  // Face map for BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
  const faceMap = { right:0, left:1, top:2, bottom:3, front:4, back:5 };

  // ---------- Funções utilitárias de textura (canvas) ----------
function makeCardboardCanvas(w=1024, h=1024, baseColor='#d39b45', drawDieline=true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    // base
    ctx.fillStyle = baseColor;
    ctx.fillRect(0,0,w,h);

    // subtle noise: draw many semi-transparent strokes
    for (let i=0;i<1200;i++){
      ctx.fillStyle = `rgba(0,0,0,${Math.random()*0.02})`;
      const x = Math.random()*w, y = Math.random()*h, rw = Math.random()*3;
      ctx.fillRect(x,y,rw,1);
    }

    // faint streaks
    

    // subtle vignette
    const grad = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)/4, w/2, h/2, Math.max(w,h)/1.2);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,w,h);

    // desenhar "dieline" - bordas e linhas de dobra
    if (drawDieline) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8,6]);
      // frame
      ctx.strokeRect(8,8,w-16,h-16);
      // cross lines (simples sugestão)
      ctx.beginPath();
      ctx.moveTo(w/2, 8);
      ctx.lineTo(w/2, h-8);
      ctx.moveTo(8, h/2);
      ctx.lineTo(w-8, h/2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // subtle paper fibers texture (tiny dots)
    const imgd = ctx.getImageData(0,0,w,h);
    const data = imgd.data;
    for (let i=0;i<5000;i++){
      const px = Math.floor(Math.random()*w);
      const py = Math.floor(Math.random()*h);
      const idx = (py*w + px) * 4;
      data[idx] = Math.min(255, data[idx] + (Math.random()*40));
      data[idx+1] = Math.min(255, data[idx+1] + (Math.random()*10));
      data[idx+2] = Math.min(255, data[idx+2] + (Math.random()*4));
    }
    ctx.putImageData(imgd, 0,0);

    return c;
}

  // quick normal map from grayscale canvas (very simple)
  function makeNormalMapFromCanvas(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const sctx = srcCanvas.getContext('2d');
    const src = sctx.getImageData(0,0,w,h);
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    const dest = ctx.createImageData(w,h);

    function lum(i){ return (src.data[i]*0.3 + src.data[i+1]*0.59 + src.data[i+2]*0.11)/255; }
    for (let y=0;y<h;y++){
      for (let x=0;x<w;x++){
        const i = (y*w + x)*4;
        const l = lum(i);
        const rx = lum(((y)*w + Math.max(0,x-1))*4) - lum(((y)*w + Math.min(w-1,x+1))*4);
        const ry = lum((Math.max(0,y-1)*w + x)*4) - lum((Math.min(h-1,y+1)*w + x)*4);
        const dx = (rx + 1) * 0.5 * 255;
        const dy = (ry + 1) * 0.5 * 255;
        dest.data[i] = Math.floor(dx);
        dest.data[i+1] = Math.floor(dy);
        dest.data[i+2] = 255;
        dest.data[i+3] = 255;
      }
    }
    ctx.putImageData(dest, 0,0);
    return c;
  }

  // ---------- Criar materiais / caixa ----------
  function createCardboardMaterials(baseColor) {
    // cria materiais 6 faces, cada um com sua CanvasTexture
    const mats = [];
    faceMaterials = [];
    currentFaceTextureCanvas = {};

    for (let i=0;i<6;i++){
      const canvas = makeCardboardCanvas(1024,1024, baseColor, true);
      currentFaceTextureCanvas[i] = canvas;

      const texture = new THREE.CanvasTexture(canvas);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.encoding = THREE.sRGBEncoding;

      const normalCanvas = makeNormalMapFromCanvas(canvas);
      const normalTex = new THREE.CanvasTexture(normalCanvas);

      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        normalMap: normalTex,
        metalness: 0.02,
        roughness: 0.9,
        color: 0xFFFFFF
      });
      mats.push(mat);
      faceMaterials.push(mat);
    }
    return mats;
  }

  function createBox(widthMM, depthMM, heightMM, baseColor) {
    // remove antigo
    if (boxMesh) {
      scene.remove(boxMesh);
      boxMesh.geometry.dispose();
      faceMaterials.forEach(m => {
        if (m.map) m.map.dispose();
        if (m.normalMap) m.normalMap.dispose();
        m.dispose();
      });
      faceMaterials = [];
      boxMesh = null;
    }

    const w = Math.max(1, widthMM);
    const h = Math.max(1, heightMM);
    const d = Math.max(1, depthMM);

    const geometry = new THREE.BoxGeometry(w, h, d);
    // ajustar origem para a base em y=0
    geometry.translate(0, h/2, 0);

    const mats = createCardboardMaterials(document.getElementById('color-picker').value);
    boxMesh = new THREE.Mesh(geometry, mats);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    scene.add(boxMesh);

    // centraliza camera
    focusBox();
  }

  function focusBox() {
    if (!boxMesh) return;
    const bbox = new THREE.Box3().setFromObject(boxMesh);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    const fitDistance = maxSize * 2.0 + 120;
    camera.position.set(center.x + fitDistance, center.y + fitDistance*0.5, center.z + fitDistance);
    controls.target.copy(center);
    controls.update();
  }

  // Inicial - criar a primeira caixa
  setTimeout(() => {
    createBox(
      parseFloat(document.getElementById('input-width').value),
      parseFloat(document.getElementById('input-depth').value),
      parseFloat(document.getElementById('input-height').value),
      document.getElementById('color-picker').value
    );
  }, 100);

  // ---------- Aplicar imagem (logo) numa face específica ----------
  let uploadedImage = null;
  document.getElementById('upload').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => { uploadedImage = img; alert('Imagem carregada. Selecione face e clique em "Aplicar Imagem".'); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(f);
  });

  // função para redesenhar a canvas de uma face incluindo o logo com posicionamento
  function drawImageOnFaceCanvas(faceIdx, img, scale=0.6, offsetX=0, offsetY=0) {
    const canvas = currentFaceTextureCanvas[faceIdx];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Recriar base (mantém a textura já feita). Vamos redraw mantendo tudo e então desenhar o logo.
    // Para simplicidade, recalc base com makeCardboardCanvas but keep original feel.
    const base = makeCardboardCanvas(canvas.width, canvas.height, document.getElementById('color-picker').value, true);
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.drawImage(base, 0,0);

    // Draw logo centered with scale and offsets (offsets in px)
    const maxW = canvas.width * scale;
    const maxH = canvas.height * scale;
    const imgRatio = img.width / img.height;
    let drawW = maxW, drawH = maxH;
    if (img.width > img.height) {
      drawH = maxW / imgRatio;
      if (drawH > maxH) { drawH = maxH; drawW = drawH * imgRatio; }
    } else {
      drawW = maxH * imgRatio;
      if (drawW > maxW) { drawW = maxW; drawH = drawW / imgRatio; }
    }
    const cx = canvas.width/2 + parseFloat(offsetX || 0);
    const cy = canvas.height/2 + parseFloat(offsetY || 0);
    ctx.drawImage(img, cx - drawW/2, cy - drawH/2, drawW, drawH);

    // small border around logo to help visibility
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - drawW/2 - 4, cy - drawH/2 - 4, drawW + 8, drawH + 8);

    // update texture and normal map
    const mat = faceMaterials[faceIdx];
    if (mat) {
      if (mat.map) mat.map.dispose();
      if (mat.normalMap) mat.normalMap.dispose();
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      mat.map = tex;

      const normalCanvas = makeNormalMapFromCanvas(canvas);
      const normalTex = new THREE.CanvasTexture(normalCanvas);
      mat.normalMap = normalTex;

      mat.needsUpdate = true;
    }
  }

  // Aplica imagem ao selecionar face / all
  document.getElementById('apply-texture').addEventListener('click', () => {
    if (!uploadedImage) { alert('Faça upload de uma imagem primeiro.'); return; }
    const faceKey = document.getElementById('face-select').value;
    const scale = parseFloat(document.getElementById('img-scale').value) || 0.6;
    const offX = parseFloat(document.getElementById('img-offset-x').value) || 0;
    const offY = parseFloat(document.getElementById('img-offset-y').value) || 0;

    if (faceKey === 'all') {
      for (let i=0;i<6;i++) drawImageOnFaceCanvas(i, uploadedImage, scale, offX, offY);
    } else {
      const idx = faceMap[faceKey];
      drawImageOnFaceCanvas(idx, uploadedImage, scale, offX, offY);
    }
  });

  document.getElementById('remove-texture').addEventListener('click', () => {
    // rebuild faces without logo
    for (let i=0;i<6;i++) {
      const canvas = makeCardboardCanvas(1024,1024, document.getElementById('color-picker').value, true);
      currentFaceTextureCanvas[i] = canvas;
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      faceMaterials[i].map = tex;
      faceMaterials[i].normalMap = new THREE.CanvasTexture(makeNormalMapFromCanvas(canvas));
      faceMaterials[i].needsUpdate = true;
    }
    uploadedImage = null;
    document.getElementById('upload').value = '';
  });

  // ---------- Eventos UI ----------
  document.getElementById('apply-dim').addEventListener('click', () => {
    const w = parseFloat(document.getElementById('input-width').value) || 150;
    const d = parseFloat(document.getElementById('input-depth').value) || 120;
    const h = parseFloat(document.getElementById('input-height').value) || 80;
    createBox(w, d, h, document.getElementById('color-picker').value);
  });

  document.getElementById('color-picker').addEventListener('input', (e) => {
    // recoloriza mantendo o desenho: recria materiais com nova cor base
    if (!boxMesh) return;
    for (let i=0;i<6;i++){
      const canvas = makeCardboardCanvas(1024,1024, e.target.value, true);
      currentFaceTextureCanvas[i] = canvas;
      if (faceMaterials[i]) {
        if (faceMaterials[i].map) faceMaterials[i].map.dispose();
        if (faceMaterials[i].normalMap) faceMaterials[i].normalMap.dispose();
        faceMaterials[i].map = new THREE.CanvasTexture(canvas);
        faceMaterials[i].normalMap = new THREE.CanvasTexture(makeNormalMapFromCanvas(canvas));
        faceMaterials[i].needsUpdate = true;
      }
    }
  });

  document.getElementById('toggle-wire').addEventListener('click', () => {
    wireframe = !wireframe;
    faceMaterials.forEach(m => m.wireframe = wireframe);
  });

  document.getElementById('fit').addEventListener('click', () => focusBox());

  document.getElementById('export').addEventListener('click', () => {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = 'caixa_preview.png'; a.click();
  });

  // Simple dieline download (2D rough) - creates an SVG with rectangle based on dims
  document.getElementById('download-dieline').addEventListener('click', () => {
    const w = parseFloat(document.getElementById('input-width').value) || 150;
    const d = parseFloat(document.getElementById('input-depth').value) || 120;
    const h = parseFloat(document.getElementById('input-height').value) || 80;
    // This is a very simplistic dieline representation for preview only
    const scale = 2; // px per mm for preview
    const svgW = (w*3 + d*2 + 120) * scale;
    const svgH = (h*2 + d + 120) * scale;
    const offsetX = 60*scale, offsetY = 60*scale;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">`;
    svg += `<rect x="${offsetX}" y="${offsetY}" width="${w*scale}" height="${h*scale}" fill="none" stroke="#000" stroke-dasharray="6,4"/>`; // front
    svg += `<rect x="${offsetX + w*scale}" y="${offsetY}" width="${d*scale}" height="${h*scale}" fill="none" stroke="#000" stroke-dasharray="6,4"/>`; // right
    svg += `<rect x="${offsetX - d*scale}" y="${offsetY}" width="${d*scale}" height="${h*scale}" fill="none" stroke="#000" stroke-dasharray="6,4"/>`; // left
    svg += `<rect x="${offsetX}" y="${offsetY - h*scale}" width="${w*scale}" height="${d*scale}" fill="none" stroke="#000" stroke-dasharray="6,4"/>`; // top
    svg += `<text x="10" y="${svgH-10}" font-size="14">Dieline preview (não para impressão) - w=${w}mm d=${d}mm h=${h}mm</text>`;
    svg += `</svg>`;
    const blob = new Blob([svg], {type: 'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dieline_preview.svg'; a.click();
    URL.revokeObjectURL(url);
  });

  // ---------- Responsividade e loop ----------
  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  });

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // Função para redimensionamento responsivo
function handleResize() {
  const container = document.getElementById('canvas-wrap');
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  // Ajusta o canvas
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  
  // Otimizações para mobile
  if (window.innerWidth < 768) {
    controls.rotateSpeed = 0.5;
    controls.panSpeed = 0.5;
    controls.enableZoom = false;
  } else {
    controls.rotateSpeed = 1.0;
    controls.panSpeed = 1.0;
    controls.enableZoom = true;
  }
}

// Inicialização
window.addEventListener('load', function() {
  // ... seu código de inicialização existente ...
  
  // Configuração inicial
  handleResize();
  
  // Listener para redimensionamento
  window.addEventListener('resize', handleResize);
});

  // ---------- Mensagem de prontidão ----------
  console.log('Visualizador pronto — caixa criada. Use os controles à direita.');

  // Carrossel
  $('.carrossel').slick({
  dots: true,
  infinite: true,
  speed: 300,
  slidesToShow: 4, // Mostrar mais cards simultaneamente
  slidesToScroll: 1,
  centerMode: false,
  focusOnSelect: false,
  responsive: [
    {
      breakpoint: 1200,
      settings: {
        slidesToShow: 3
      }
    },
    {
      breakpoint: 768,
      settings: {
        slidesToShow: 2
      }
    },
    {
      breakpoint: 480,
      settings: {
        slidesToShow: 1,
        centerMode: true,
        centerPadding: '20px'
      }
    }
  ]
});

// Menu Hamburguer
document.addEventListener('DOMContentLoaded', function() {
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  const header = document.querySelector('.header');
  
  // Adiciona classe ao header para controle
  menuToggle.addEventListener('click', function() {
    this.classList.toggle('active');
    nav.classList.toggle('active');
    header.classList.toggle('menu-open');
    
    // Bloqueia scroll quando menu está aberto
    document.body.style.overflow = nav.classList.contains('active') ? 'hidden' : '';
  });
  
  // Fecha menu ao clicar em links
  document.querySelectorAll('.nav a').forEach(link => {
    link.addEventListener('click', () => {
      menuToggle.classList.remove('active');
      nav.classList.remove('active');
      header.classList.remove('menu-open');
      document.body.style.overflow = '';
    });
  });
});