/* Scene library. Each scene is GLSL: vec3 scene(vec2 uv, vec2 p)
   uv: 0..1 across this door (or both doors when spanning), p: centered, y in [-0.5,0.5], x in [-aspect/2, aspect/2].
   Signals: uHit/uHitEv (bursts), uAcc/uAccEv (sparks), uFlow (motion/swell), uGlow (brightness), uBeat/uBar (tempo-locked motion),
   uTravel (distance travelled, faster in loud parts), uCells (pattern per door panel), uPal (palette, linear RGB). Output linear HDR. */
const SCENES = {};
function scene(id, meta, glsl) { SCENES[id] = Object.assign({ id, glsl, params: [] }, meta); }

/* ---------- shared sky helpers (pasted into scenes that need them) */
const STARS_GLSL = `
float starLayer(vec2 p, float dens, float tw, float seed){
  vec2 g = p*dens; vec2 id = floor(g); vec2 f = fract(g)-0.5; vec2 h = hash22(id+seed);
  vec2 o = (h-0.5)*0.75; float d = length(f-o);
  float b = pow(hash12(id*1.37+seed), 9.)*2.2 + 0.04;
  float twk = mix(1., 0.55+0.45*sin(uTime*(1.5+h.x*4.)+h.y*TAU), tw);
  return b*twk*(0.004/(d*d*dens*0.6+0.004))*smoothstep(0.5,0.2,d);
}`;

scene('bethlehem', { name: 'Star of Bethlehem', cat: 'Christian', speed: 'slow', palette: 'bethlehem', mode: 'split', companion: 'starfield', family: ['starfield', 'glory'],
  params: [{ name: 'Town', def: 1 }, { name: 'Ray length', def: 0.6 }, { name: 'Stars', def: 0.6 }] }, STARS_GLSL + `
float town(vec2 p, out float g){
  g = -0.5 + 0.085 + 0.03*sin(p.x*2.1+1.3) + 0.015*sin(p.x*5.7);
  float d = p.y - g;
  // stable under the star
  vec2 s = p - vec2(0.0, g+0.03);
  float body = sdBox(s, vec2(0.085, 0.035));
  float roof = max(s.y - (0.105 - abs(s.x)*0.62), -(s.y-0.03));
  roof = max(roof, abs(s.x)-0.12);
  float door = sdBox(s-vec2(0.,-0.01), vec2(0.022,0.026));
  d = min(d, max(min(body, roof), -door));
  // town on the left and right: houses with flat roofs and a few domes
  for(int i=0;i<9;i++){ float fi = float(i); float side = i<5 ? -1. : 1.;
    float x = side*(0.32 + 0.11*mod(fi,5.) + 0.05*hash11(fi*3.1)); float w = 0.035+0.025*hash11(fi*7.7); float h = 0.03+0.05*hash11(fi*1.9);
    vec2 q = p - vec2(x, g + h*0.5 + 0.005); d = min(d, sdBox(q, vec2(w, h*0.5+0.01)));
    if(hash11(fi*5.3) > 0.6) d = min(d, length(p - vec2(x, g+h+0.004)) - w*0.7);
  }
  // palm silhouettes
  for(int i=0;i<2;i++){ float x = i==0 ? -0.2 : 0.22; vec2 q = p - vec2(x, g);
    d = min(d, sdSeg(q, vec2(0.), vec2(0.015, 0.16)) - 0.006);
    for(int k=0;k<5;k++){ float a = -0.4 + float(k)*0.55; vec2 tip = vec2(0.015,0.16) + vec2(cos(a+1.2), sin(a+1.2)*0.5-0.25)*0.07*vec2(i==0?-1.:1.,1.);
      d = min(d, sdSeg(q, vec2(0.015,0.16), tip) - 0.004); } }
  return d;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = mix(vec3(0.0005,0.0008,0.004), vec3(0.002,0.004,0.02), uv.y);
  float sd = uParam.z;
  col += vec3(0.75,0.85,1.)*(starLayer(p, 28., 0.8, 1.)*sd*1.5 + starLayer(p+7.3, 60., 1., 9.)*sd);
  vec2 c = vec2(0., 0.15); vec2 q = p - c; float r = length(q); float a = atan(q.y, q.x);
  float k = 0.7 + 0.55*uGlow + 0.55*uHit;
  float L = 0.5 + uParam.y;
  float core = 0.0009/(r*r+0.0009);
  float halo = exp(-r*7.)*0.55 + exp(-r*2.2)*0.12;
  float rayH = exp(-abs(q.y)*(260.-60.*uHit))*exp(-abs(q.x)*3.2/L);
  float rayV = exp(-abs(q.x)*(260.-60.*uHit))*exp(-abs(q.y)*(q.y<0. ? 1.1 : 3.4)/L);
  vec2 qd = rot(PI*0.25)*q;
  float rayD = (exp(-abs(qd.y)*380.)*exp(-abs(qd.x)*10./L) + exp(-abs(qd.x)*380.)*exp(-abs(qd.y)*10./L))*0.55;
  float fan = pow(0.5+0.5*sin(a*22. + uBeat*0.12), 10.)*exp(-r*4.5)*0.35 + pow(noise(vec2(a*9., uTravel*0.25)), 3.)*exp(-r*6.)*0.4;
  vec3 starCol = mix(uPal[0], vec3(1.), 0.55);
  col += starCol*(core*1.8 + halo*(0.6+0.4*uGlow) + (rayH*1.3 + rayV*1.3 + rayD)*k + fan*k);
  for(int i=0;i<4;i++){ vec4 e = uHitEv[i]; if(e.x>2.5) continue; float rr = 0.03+e.x*0.42;
    col += mix(uPal[0], uPal[3], 0.5)*exp(-pow((r-rr)*70.,2.))*exp(-e.x*2.6)*e.y*0.3; }
  if(uParam.x > 0.5){
    float gl; float d = town(p, gl);
    float sil = smoothstep(0.0025, -0.0025, d);
    float rim = exp(-abs(d)*260.)*smoothstep(-0.3, 0.2, p.y)*(0.5+0.5*k)*exp(-abs(p.x)*2.);
    col *= 1. - sil;
    col += uPal[3]*rim*0.35*sil + uPal[0]*rim*0.12;
    float doorGlow = exp(-length((p - vec2(0., gl+0.02))*vec2(1.,1.5))*40.)*0.6*k;
    col += uPal[3]*doorGlow*(1.-step(0.,-0.)) ;
  }
  return col;
}`);

scene('starfield', { name: 'Night Sky', cat: 'Stars', speed: 'slow', palette: 'icy', mode: 'span', companion: 'starfield', family: ['bethlehem', 'warp'],
  params: [{ name: 'Density', def: 0.6 }, { name: 'Twinkle', def: 0.6 }, { name: 'Milky Way', def: 0.7 }] }, STARS_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec2 q = rot(uTravel*0.004)*p;
  vec3 col = mix(vec3(0.0003,0.0006,0.003), vec3(0.0015,0.003,0.014), uv.y);
  float band = exp(-pow((q.y - 0.32*q.x - 0.05)*3.2, 2.));
  float mw = fbm(q*3.5 + vec2(uTravel*0.01, 0.)); float dust = fbm(q*9. + 3.);
  col += (mix(uPal[3], uPal[1], mw)*0.03 + vec3(0.02,0.02,0.03)*pow(dust,3.))*band*smoothstep(0.45,0.8,mw)*uParam.z*1.6*(0.7+0.5*uGlow);
  float dn = 0.4 + uParam.x;
  float tw = uParam.y;
  float s = starLayer(q, 22.*dn, tw, 1.) + starLayer(q+3.1, 45.*dn, tw, 2.)*0.8 + starLayer(q+9.7, 90.*dn, tw, 3.)*0.5*band + starLayer(q+1.7, 90.*dn, tw, 5.)*0.25;
  vec3 tint = mix(vec3(0.8,0.88,1.), uPal[0], 0.35);
  col += tint*s*(0.65 + 0.6*uGlow);
  // accent sparkles: random stars flare
  for(int i=0;i<4;i++){ vec4 e = uAccEv[i]; if(e.x>0.6) continue; vec2 sp = vec2((hash11(e.z*91.)-0.5)*uAspect*0.95, (hash11(e.z*37.)-0.5)*0.9);
    vec2 d = p - sp; float f = exp(-e.x*6.)*e.y; col += uPal[2]*f*(0.0006/(dot(d,d)+0.0006) + exp(-abs(d.y)*500.)*exp(-abs(d.x)*25.)*0.5 + exp(-abs(d.x)*500.)*exp(-abs(d.y)*25.)*0.5); }
  // shooting stars on hits
  for(int i=0;i<5;i++){ vec4 e = uHitEv[i]; if(e.x>1.1) continue;
    float sx = (hash11(e.z*13.1)-0.5)*uAspect*0.9; vec2 st = vec2(sx, 0.42 - 0.2*hash11(e.z*7.7));
    vec2 dir = normalize(vec2((hash11(e.z*3.3)>0.5?1.:-1.)*(0.6+0.5*hash11(e.z*5.)), -0.55));
    float tt = e.x; vec2 head = st + dir*tt*1.25; vec2 tail = head - dir*min(tt*1.25, 0.32);
    float d = sdSeg(p, head, tail); float along = clamp(dot(p-tail, dir)/max(0.001,length(head-tail)), 0., 1.);
    col += mix(uPal[1], vec3(1.), along)*along*along*exp(-d*d*90000.)*exp(-tt*2.2)*e.y*2.2;
    col += vec3(1.)*0.0004/(dot(p-head,p-head)+0.0004)*exp(-tt*2.5)*e.y; }
  return col;
}`);

scene('warp', { name: 'Hyperspace', cat: 'Big motion', speed: 'fast', palette: 'icy', mode: 'same', companion: 'warp', family: ['starfield', 'fireworks'],
  params: [{ name: 'Streaks', def: 0.5 }, { name: 'Density', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float r = length(p); float a = atan(p.y, p.x);
  float spd = uTravel*0.9 + uHit*0.06;
  float sl = 0.15 + uParam.x*0.6;
  for(int L=0; L<3; L++){ float fl = float(L);
    float n = floor(60. + fl*55. + uParam.y*60.);
    float ai = floor((a/TAU + 0.5)*n);
    for(int j=0;j<2;j++){ float fj = float(j);
      float h = hash11(ai*7.31 + fl*13.7 + fj*3.3); float h2 = hash11(ai*3.17 + fl*5.1 + fj*9.1);
      float z = fract(h - spd*(0.22 + 0.12*fl + 0.05*fj));
      float rr = 0.035/max(z, 0.02);
      float len = rr*sl*(0.35+0.65*(0.4+uFlow*0.6));
      float ac = ((ai + 0.5 + (h2-0.5)*0.6)/n)*TAU - PI;
      float perp = abs(sin(a-ac))*r;
      float along = smoothstep(rr-len, rr, r)*step(r, rr);
      float w = 0.0012 + 0.0035*(1.-z);
      float b = along*exp(-perp*perp/(w*w))*(1.-z)*(1.-z)*1.6*smoothstep(0.06, 0.3, r);
      vec3 sc = mix(vec3(1.), pal(h2 + fl*0.25), 0.55);
      col += sc*b;
    }
  }
  float rings = exp(-pow(fract(log(r+0.001)*2.2 - spd*0.8)-0.5, 2.)*90.)*0.025*smoothstep(0.02,0.3,r);
  col += uPal[1]*rings*(0.5+uGlow);
  col += mix(uPal[0], vec3(1.), 0.5)*exp(-r*16.)*(0.12+0.3*uFlow+0.3*uGlow);
  col += vec3(1.)*uFlash*0.25*exp(-r*2.);
  return col;
}`);

scene('aurora', { name: 'Northern Lights', cat: 'Simulation', speed: 'slow', palette: 'aurora', mode: 'span', companion: 'aurora', family: ['starfield', 'snowstorm'],
  params: [{ name: 'Curtains', def: 0.6 }, { name: 'Pine trees', def: 1 }] }, STARS_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = mix(vec3(0.0,0.001,0.002), vec3(0.0005,0.002,0.008), uv.y);
  col += vec3(0.7,0.8,1.)*(starLayer(p, 40., 0.7, 2.)*0.8 + starLayer(p+5., 80., 1., 4.)*0.4);
  float t = uTravel*0.05;
  float ripple = 0.;
  for(int i=0;i<4;i++){ vec4 e = uHitEv[i]; if(e.x>3.) continue; float pos = -uAspect*0.5 - 0.2 + e.x*1.3*(uAspect*0.4+0.6);
    ripple += exp(-pow((p.x - pos)*3., 2.))*exp(-e.x*0.9)*e.y; }
  float nc = 2. + floor(uParam.x*3.);
  for(int i=0;i<5;i++){ float fi = float(i); if(fi >= nc) break;
    float x = p.x*0.5 + fi*1.73;
    float warp = fbm3(vec2(x*1.3 + t*0.7, fi*2.1 + t*0.3));
    float xx = x + 0.35*warp;
    float base = -0.1 + 0.42*fbm3(vec2(xx*0.8 + t*(0.5+fi*0.12), fi*3.1 + t*0.15)) + fi*0.04;
    float h = p.y - base;
    float curt = smoothstep(-0.006, 0.02, h)*exp(-max(h,0.)*(2.2+fi*0.7));
    float rays = 0.25 + 0.75*pow(noise(vec2(xx*42. + t*5., fi*7.)), 1.4);
    rays *= 0.5 + 0.5*noise(vec2(xx*7. - t*2., fi + 3.));
    float bright = smoothstep(0.2, 0.7, fbm3(vec2(xx*1.6 - t*0.8, fi*5.)));
    vec3 c = mix(uPal[0], uPal[1], smoothstep(0.,0.15,h)*0.5); c = mix(c, uPal[2], smoothstep(0.1, 0.42, h));
    col += c*curt*rays*bright*(0.45 + 0.6*uGlow + 0.25*uFlow)*(1. + 1.2*ripple)*(1.-fi*0.1)*1.3;
  }
  if(uParam.y > 0.5){
    float yb = -0.5 + 0.035 + 0.012*sin(p.x*3.);
    float cell = floor(p.x*13.); float lx = fract(p.x*13.) - 0.5; float th = 0.07 + 0.09*hash11(cell*4.7);
    float y = p.y - yb; float w = 0.42*(1. - y/th); w += 0.05*sin(y*130.)*(1.-y/th);
    float tree = step(abs(lx), w)*step(0., y)*step(y, th);
    float sil = max(tree, step(p.y, yb));
    col *= 1. - sil;
  }
  return col;
}`);

scene('fireworks', { name: 'Fireworks', cat: 'Simulation', speed: 'fast', palette: 'classic', mode: 'span', companion: 'fireworks', family: ['starfield', 'warp'],
  params: [{ name: 'Size', def: 0.6 }, { name: 'Glitter', def: 0.6 }, { name: 'Rockets', def: 1 }] }, `
uniform vec4 uHitNextSeed;
vec2 burstC(float s){ return vec2((hash11(s*17.3)-0.5)*uAspect*0.8, 0.0 + 0.28*hash11(s*7.1)); }
vec3 burst(vec2 p, vec4 e, float big){
  float age = e.x; if(age > 3.4 || age < 0.) return vec3(0.);
  float s = e.z; vec2 c = burstC(s); float type = floor(hash11(s*29.)*4.);
  float sz = (0.6 + uParam.x*0.8)*big*(0.75 + 0.35*e.y);
  float life = type == 2. ? 3.0 : 1.9;
  if(age > life) return vec3(0.);
  float g = type == 2. ? 0.16 : 0.1;
  float maxR = 0.5*sz + g*age*age + 0.06;
  vec2 dc = p - c; if(length(dc) > maxR + 0.06) return vec3(0.);
  vec3 c1 = pal(hash11(s*3.7)); vec3 c2 = pal(hash11(s*5.9) + 0.5);
  if(type == 2.) { c1 = mix(uPal[2], vec3(1.,0.72,0.3), 0.7); c2 = vec3(1.,0.9,0.6); }
  vec3 acc = vec3(0.);
  float fade = exp(-age*(type == 2. ? 0.9 : 1.6));
  for(int i=0;i<44;i++){ float fi = float(i);
    float hi = hash11(fi*1.7 + s*31.);
    float ang = fi/44.*TAU + s*6.28 + (hi-0.5)*0.12;
    float sp = type == 1. ? 0.36 : type == 3. ? (mod(fi, 2.) < 1. ? 0.38 : 0.22) : 0.22 + 0.2*hi;
    float v = sp*sz*1.45;
    float drag = type == 2. ? 1.3 : 2.1;
    vec2 dir = vec2(cos(ang), sin(ang));
    float tl = type == 2. ? 0.5 : 0.16;
    float t0 = age, t1 = max(0., age - tl);
    vec2 p0 = c + dir*v*(1.-exp(-drag*t0))/drag - vec2(0., g*t0*t0);
    vec2 p1 = c + dir*v*(1.-exp(-drag*t1))/drag - vec2(0., g*t1*t1);
    vec2 ba = p0 - p1; vec2 pa = p - p1; float hh = clamp(dot(pa, ba)/max(dot(ba, ba), 1e-7), 0., 1.);
    float d = length(pa - ba*hh);
    float glit = mix(1., step(0.45, hash11(floor(age*24.) + fi*7. + s)), uParam.y*smoothstep(life*0.35, life*0.7, age));
    vec3 cc = (type == 3. && mod(fi, 2.) < 1.) ? c2 : c1;
    acc += cc*fade*glit*(0.00005/(d*d + 0.00005))*(0.25 + 0.75*hh*hh)*smoothstep(0.05, 0.0, d);
    vec2 hd = p - p0; acc += mix(cc, vec3(1.), 0.6)*fade*glit*0.000025/(dot(hd,hd) + 0.000025)*1.2*smoothstep(0.04, 0.0, length(hd));
  }
  float fl = exp(-age*14.); acc += mix(c1, vec3(1.), 0.7)*fl*(0.003/(dot(dc,dc) + 0.003))*0.8*smoothstep(maxR + 0.06, 0., length(dc));
  return acc*e.y*1.1;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.0003, 0.0004, 0.0015)*(0.5 + uv.y);
  for(int i=0;i<7;i++) col += burst(p, uHitEv[i], 1.);
  for(int i=0;i<4;i++){ vec4 e = uAccEv[i]; if(e.x > 0.7) continue;
    vec2 c = vec2((hash11(e.z*41.)-0.5)*uAspect*0.9, (hash11(e.z*23.)-0.35)*0.7);
    for(int k=0;k<12;k++){ float fk = float(k); float a = fk/12.*TAU + e.z*9.; vec2 pp = c + vec2(cos(a),sin(a))*(0.04+0.03*hash11(fk+e.z))*(1.-exp(-e.x*7.));
      vec2 d = p-pp; col += vec3(1.,0.95,0.8)*0.00002/(dot(d,d)+0.00002)*exp(-e.x*5.)*e.y*step(0.4, hash11(floor(e.x*30.)+fk)); } }
  if(uParam.z > 0.5){
    for(int k=0;k<4;k++){ float tn = uHitNext[k]; if(tn <= 0. || tn > 0.7) continue;
      float s = uHitNextSeed[k]; vec2 c = burstC(s); float f = 1. - tn/0.7;
      vec2 start = vec2(c.x + (hash11(s*3.)-0.5)*0.15, -0.56);
      float ff = 1. - (1.-f)*(1.-f);
      vec2 head = mix(start, c, ff); vec2 tail = mix(start, c, max(0., ff - 0.18));
      vec2 ba = head - tail; vec2 pa = p - tail; float hh = clamp(dot(pa,ba)/max(dot(ba,ba),1e-7), 0., 1.); float d = length(pa - ba*hh);
      col += vec3(1.,0.7,0.35)*0.00003/(d*d + 0.00003)*hh*0.8 + vec3(1.,0.9,0.7)*0.00008/(dot(p-head,p-head)+0.00008)*0.7; }
  }
  return col;
}`);

scene('snowstorm', { name: 'Snowfall', cat: 'Simulation', speed: 'any', palette: 'icy', mode: 'span', companion: 'snowstorm', family: ['icicles', 'snowflake'],
  params: [{ name: 'Amount', def: 0.6 }, { name: 'Wind', def: 0.4 }, { name: 'Flake size', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = mix(vec3(0.0,0.001,0.003), vec3(0.001,0.003,0.01), uv.y);
  float gust = 0.;
  for(int i=0;i<6;i++){ vec4 e = uHitEv[i]; gust += e.y*e.x*exp(-e.x*3.5)*(e.x<20. ? 1. : 0.); }
  for(int i=0;i<4;i++){ vec4 e = uAccEv[i]; gust += 0.4*e.y*e.x*exp(-e.x*5.)*(e.x<20. ? 1. : 0.); }
  float wind = uParam.y*(0.4 + uFlow*0.6);
  for(int l=0;l<5;l++){ float fl = float(l);
    float sc = 16. - fl*2.6;
    vec2 q = p*sc;
    q.y += uTravel*(0.18 + fl*0.07)*sc*0.35;
    q.x += (uTravel*wind*0.25 + gust*(0.8+fl*0.5))*sc*0.3 + sin(q.y*0.21 + fl*2.)*0.8;
    vec2 id = floor(q); vec2 f = fract(q) - 0.5; vec2 h = hash22(id + fl*31.7);
    if(h.x > 0.2 + uParam.x*0.55) continue;
    vec2 o = (h - 0.5)*0.55 + vec2(0.18*sin(uTime*(0.6+h.y)+h.x*9.), 0.);
    float d = length(f - o);
    float sz = (0.05 + 0.1*h.y)*(0.6 + uParam.z*0.9)*(1. + fl*0.1);
    float soft = mix(0.2, 0.9, fl/4.);
    float flake = smoothstep(sz, sz*(1.-soft), d);
    float tw = 0.75 + 0.25*sin(uTime*3. + h.x*20.);
    vec3 fc = mix(vec3(0.95,0.97,1.), pal(h.y), 0.25);
    col += fc*flake*tw*(0.2 + 0.15*fl)*(0.7 + 0.5*uGlow)*(fl==4. ? 0.6 : 1.);
  }
  float sweep = exp(-pow((p.x/uAspect + 0.6 - fract(uBar*0.5)*2.2)*4., 2.))*0.04*(0.4+uEnergy);
  col += uPal[1]*sweep;
  col += uPal[0]*exp(-(p.y+0.5)*9.)*0.06*(0.5+uGlow);
  return col;
}`);

scene('tree', { name: 'Light Tree', cat: 'Christmas', speed: 'any', palette: 'classic', mode: 'split', companion: 'ornaments', cells: true, family: ['ornaments', 'fireworks'],
  params: [{ name: 'Strands', def: 0.5 }, { name: 'Spin', def: 0.5 }, { name: 'Side trees', def: 0.5 }] }, `
vec3 tree(vec2 p, vec2 base, float H, float W, float sid){
  vec2 q = p - base; vec3 col = vec3(0.);
  vec2 sp = q - vec2(0., H*1.06); float sr = H*0.075*(1. + 0.25*uHit);
  float ds = sdStar5(rot(uBeat*0.05)*sp, sr, 0.45);
  vec3 sc = mix(uPal[2], vec3(1.), 0.4);
  col += sc*(smoothstep(0.003, -0.002, ds)*1.4 + 0.002/(max(ds,0.)*max(ds,0.)*40. + 0.002)*0.25*(0.7+uGlow+uHit)*smoothstep(0.25, 0.0, ds));
  col += sc*exp(-length(sp)*12.)*0.2*(0.5+uHit)*smoothstep(0.35, 0.0, length(sp));
  float v = q.y/H; if(v < -0.15 || v > 1.3 || abs(q.x) > W*1.35) return col;
  float ns = 3. + floor(uParam.x*4.);
  float turns = 4.5;
  float spin = uBeat*TAU/16.*(0.4+uParam.y*1.2)*uSpeed + sid;
  float vv = clamp(v, 0., 1.);
  float R = W*pow(1.-vv, 0.92);
  for(int s=0;s<7;s++){ float fs = float(s); if(fs >= ns) break;
    float th = vv*turns*TAU + spin + fs*TAU/ns;
    float x = R*sin(th); float z = cos(th);
    float slope = (-W*0.92*pow(1.-vv,-0.08)*sin(th) + R*cos(th)*turns*TAU)/H;
    float d = abs(q.x - x)/sqrt(1. + slope*slope);
    float depth = 0.25 + 0.75*smoothstep(-0.6, 0.6, z);
    float nb = 34.; float kb = floor(vv*nb); float vb = (kb+0.5)/nb;
    float thb = vb*turns*TAU + spin + fs*TAU/ns; vec2 bp = vec2(W*pow(1.-vb,0.92)*sin(thb), vb*H);
    float zb = cos(thb);
    float cellv0 = cellAt(vec2(fract(fs/ns + 0.0001), vb));
    float chase = 0.35 + 0.65*pow(0.5+0.5*cos(thb - uBeat*PI*0.5), 3.);
    vec3 bc = pal(fs*0.25 + floor(uBar)*0.25 + kb*0.02);
    float lit = cellv0*chase*(0.25 + 0.75*smoothstep(-0.5, 0.6, zb));
    vec2 dd = q - bp; float bulb = 0.00009/(dot(dd,dd)+0.00009)*smoothstep(0.09, 0.0, length(dd));
    col += bc*bulb*lit*(0.8 + 0.6*uGlow + 0.8*uHit);
    col += bc*exp(-d*d*80000.)*0.12*depth*cellv0*step(v,1.)*step(0.,v);
  }
  col += uPal[1]*0.006*smoothstep(0.03, 0., abs(q.x) - R)*step(0.,v)*step(v,1.);
  return col;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  col += tree(p, vec2(0., -0.44), 0.78, 0.3, 0.);
  if(uAspect > 1.7 && uParam.z > 0.3){
    float x = uAspect*0.5 - 0.27;
    col += tree(p, vec2(-x, -0.44), 0.5, 0.19, 2.1)*0.85;
    col += tree(p, vec2( x, -0.44), 0.5, 0.19, 4.2)*0.85;
  }
  col += uPal[2]*exp(-(p.y+0.5)*14.)*0.05*(0.5+uGlow);
  return col;
}`);

scene('rosewindow', { name: 'Rose Window', cat: 'Christian', speed: 'slow', palette: 'jewel', mode: 'same', companion: 'rosewindow', cells: true, family: ['candles', 'glory'],
  params: [{ name: 'Center: cross/star', def: 0 }, { name: 'Lead lines', def: 0.5 }, { name: 'Light rays', def: 0.6 }] }, `
float lead(float d, float w){ return smoothstep(w, w*0.4, abs(d)); }
vec3 glass(float idx, float ring, vec2 p){
  float h = hash11(idx*7.3 + ring*13.1);
  vec3 c = palc(int(mod(idx + ring*2., 4.)));
  c = mix(c, palc(int(mod(idx+ring+1., 4.))), h*0.25);
  float mott = 0.65 + 0.5*fbm3(p*38. + idx*3.1);
  return c*mott;
}
vec3 rose(vec2 p, float R){
  float r = length(p)/R; float a = atan(p.y, p.x);
  if(r > 1.06) return vec3(0.);
  float lw = 0.008 + uParam.y*0.012;
  vec3 col = vec3(0.); float lt = 0.; float leadm = 0.; float ringRow = 0.; float seg = 0.; float idx = 0.;
  float an = fract(a/TAU + 0.25);
  if(r < 0.2){ ringRow = 3.; seg = 0.; idx = 0.;
    vec2 q = p/R;
    float sym = uParam.x < 0.5 ? min(sdBox(q, vec2(0.022, 0.12)), sdBox(q - vec2(0., 0.035), vec2(0.08, 0.022)))
                               : sdStar5(q, 0.11, 0.42);
    float inSym = smoothstep(0.004, -0.004, sym);
    col = mix(uPal[0]*0.8, vec3(1., 0.92, 0.7), inSym)*(0.75 + 0.5*fbm3(q*30.));
    leadm = max(lead(sym, lw*0.6/R), lead(r-0.2, lw/R));
  } else if(r < 0.46){ ringRow = 2.; float n = 8.; seg = floor(an*n); float f = fract(an*n)-0.5;
    vec2 lp = vec2(f*1.6, (r-0.33)/0.13);
    float petal = length(lp*vec2(1.,0.8)) - 0.95;
    leadm = max(lead(abs(f)*r*TAU/n*R - 0., lw*0.9), lead(r-0.46, lw/R));
    leadm = max(leadm, lead(petal*0.06, lw*0.6));
    idx = seg; col = glass(seg + step(0., petal)*8., 1., p);
  } else if(r < 0.78){ ringRow = 1.; float n = 16.; seg = floor(an*n); float f = fract(an*n)-0.5;
    vec2 lp = vec2(f*TAU/n*0.62, r-0.62);
    float circ = length(lp) - 0.11;
    leadm = max(lead(abs(f)*r*TAU/n*R, lw*0.9), lead(r-0.78, lw/R));
    leadm = max(leadm, lead(circ*R, lw*0.7));
    idx = seg + 20.; col = glass(seg*1.7 + step(0., circ)*5., 2., p);
  } else if(r < 1.){ ringRow = 0.; float n = 24.; seg = floor(an*n); float f = fract(an*n)-0.5;
    leadm = max(lead(abs(f)*r*TAU/n*R, lw*0.8), lead(r-1., lw*1.6/R));
    idx = seg + 40.; col = glass(seg*2.3, 3., p);
  } else { return vec3(0.03,0.025,0.02)*(0.5+0.5*fbm3(p*20.)) * smoothstep(1.06, 1.0, r); }
  float cols = uGrid.x; float rows = uGrid.y;
  float cl = cellv(int(min(rows-1., floor(ringRow*rows/4.)))*int(cols) + int(floor(an*cols)));
  float light = 0.18 + 0.82*cl;
  light *= 0.75 + 0.45*uGlow + 0.35*uHit;
  col = col*light*1.25;
  col *= 1. - leadm;
  return col;
}
vec3 lancet(vec2 p, vec2 c, float w, float h, float id){
  vec2 q = p - c; float top = h*0.5;
  float arch = max(length(q - vec2(-w*0.6, top)), length(q - vec2(w*0.6, top))) - w*1.6;
  float body = sdBox(q, vec2(w, top));
  float d = q.y > top ? max(arch, abs(q.x)-w) : body;
  if(d > 0.012) return vec3(0.);
  float lw = 0.006 + uParam.y*0.008;
  float panes = 4.; float py = floor((q.y/(h) + 0.5)*panes); float px = step(0., q.x);
  float leadm = max(lead(d, lw), lead(q.x, lw*0.8));
  leadm = max(leadm, lead((fract((q.y/h+0.5)*panes)-0.5)*h/panes, lw*0.6)*step(q.y, top));
  float cl = cellAt(vec2(clamp((p.x/uAspect)+0.5, 0., 0.999), clamp(py/panes, 0., 0.999)));
  vec3 col = glass(py*2. + px + id*9., 4. + id, p)*(0.18 + 0.82*cl)*(0.75 + 0.45*uGlow + 0.35*uHit)*1.2;
  return col*(1.-leadm)*smoothstep(0.004, -0.002, d);
}
vec3 scene(vec2 uv, vec2 p){
  float R = 0.45;
  vec3 col = rose(p, R);
  if(uAspect > 1.7){ float x = uAspect*0.5 - 0.22; col += lancet(p, vec2(-x, -0.06), 0.085, 0.62, 1.) + lancet(p, vec2(x, -0.06), 0.085, 0.62, 2.); }
  float r = length(p); float a = atan(p.y, p.x);
  float rays = pow(noise(vec2(a*14., uTravel*0.15)), 3.)*smoothstep(R, R*1.6, r)*exp(-(r-R)*3.)*uParam.z;
  col += mix(uPal[2], vec3(1.,0.9,0.7), 0.5)*rays*0.35*(0.5+uGlow);
  col += vec3(1.,0.9,0.7)*uFlash*0.15*smoothstep(R*1.05, R*0.9, r);
  return col;
}`);

scene('candles', { name: 'Candlelight', cat: 'Christian', speed: 'slow', palette: 'warm', mode: 'span', companion: 'candles', cells: true, family: ['rosewindow', 'glory'],
  params: [{ name: 'Candles', def: 0.5 }, { name: 'Flicker', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.004,0.002,0.001);
  // background bokeh
  for(int i=0;i<10;i++){ float fi = float(i); vec2 c = vec2((hash11(fi*3.1)-0.5)*uAspect, (hash11(fi*7.9)-0.3)*0.8);
    float rr = 0.03 + 0.04*hash11(fi*5.); float d = length(p-c);
    col += uPal[0]*0.025*smoothstep(rr, rr*0.8, d)*(0.6+0.4*sin(uTime*0.5+fi))*(0.5+0.5*uGlow); }
  float n = max(3., floor(uAspect*(2.6 + uParam.x*2.4)));
  for(int k=-1;k<=1;k++){ float j = floor((p.x/uAspect + 0.5)*n) + float(k); if(j < 0. || j >= n) continue;
    float cj = hash11(j*1.93 + 0.7); float ytj = -0.44 + 0.03*hash11(j*2.3) + 0.26 + 0.16*cj;
    float clj = cellAt(vec2((j+0.5)/n, 0.15)); float litj = smoothstep(0.05, 0.35, clj);
    vec2 gj = vec2(p.x - ((j+0.5)/n - 0.5)*uAspect, p.y - ytj - 0.04);
    col += uPal[0]*(0.0009/(dot(gj,gj)+0.0009))*litj*(0.55 + 0.4*uGlow)*0.6 + uPal[0]*exp(-length(gj)*7.)*0.06*litj; }
  float xs = (p.x/uAspect + 0.5)*n; float i = floor(xs); float lx = (fract(xs)-0.5)*uAspect/n;
  float ci = hash11(i*1.93 + 0.7);
  float hgt = 0.26 + 0.16*ci;
  float w = min(0.055, uAspect/n*0.26);
  float yb = -0.44 + 0.03*hash11(i*2.3), yt = yb + hgt;
  float cl = cellAt(vec2((i+0.5)/n, 0.15));
  float lit = smoothstep(0.05, 0.35, cl);
  float flick = uParam.y;
  float ft = uTime*(7. + ci*3.);
  float fh = (0.07 + 0.035*uGlow + 0.015*sin(ft) * flick + 0.01*noise(vec2(ft*0.7, i)))*lit*(0.7 + 0.3*cl);
  vec2 fp = vec2(lx + 0.006*sin(ft*1.3 + i)*flick*smoothstep(yt, yt+fh, p.y), p.y - yt - 0.012);
  // wax body
  float body = sdRBox(vec2(lx, p.y - (yb+yt)*0.5), vec2(w, hgt*0.5), 0.006);
  float wy = clamp((p.y - yb)/hgt, 0., 1.);
  vec3 wax = mix(vec3(0.35,0.22,0.12), vec3(0.95,0.78,0.55), wy*wy)*(0.12 + 0.88*lit*(0.6+0.4*smoothstep(0.6,1.,wy)));
  wax *= 0.75 + 0.25*smoothstep(-w, w*0.3, lx);
  col = mix(col, wax*0.5, smoothstep(0.002, -0.002, body));
  // wick
  col *= 1. - smoothstep(0.0025, 0.0, sdSeg(vec2(lx, p.y), vec2(0., yt), vec2(0., yt+0.012)))*0.8;
  // flame
  if(fh > 0.001){
    vec2 q = fp/vec2(0.55, 1.)/max(fh, 0.001);
    q.y -= 0.35; float k = q.y > 0. ? 0.42*(1. - q.y*0.9) : 0.42*sqrt(max(0., 1. - q.y*q.y*9.));
    float d = abs(q.x) - max(k, 0.) + (q.y > 1.1 || q.y < -0.34 ? 1. : 0.);
    float inner = smoothstep(0.08, -0.25, d + 0.12);
    float outer = smoothstep(0.12, -0.12, d);
    vec3 fc = mix(vec3(1., 0.42, 0.08), vec3(1., 0.86, 0.5), inner);
    fc = mix(fc, vec3(1.,0.98,0.9), smoothstep(-0.1,-0.35,d)*0.8);
    fc += vec3(0.1,0.2,0.9)*smoothstep(0.2, 0., abs(q.y + 0.25))*outer*0.6;
    col += fc*outer*2.2;
    vec2 g = vec2(lx, p.y - yt - fh*0.45);
    col += uPal[0]*(0.0004/(dot(g,g)+0.0004))*lit*(0.5 + 0.4*uGlow)*smoothstep(0.12, 0.0, length(g));
  }
  return col;
}`);

scene('glory', { name: "Heaven's Light", cat: 'Christian', speed: 'slow', palette: 'warm', mode: 'same', companion: 'glory', family: ['bethlehem', 'rosewindow'],
  params: [{ name: 'Cross', def: 0 }, { name: 'Clouds', def: 0.6 }, { name: 'Rising light', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  vec2 src = vec2(0., 0.72);
  vec2 d = p - src; float ang = atan(d.x, -d.y); float dist = length(d);
  float t = uTravel*0.04;
  float r1 = pow(noise(vec2(ang*16., t)), 3.);
  float r2 = pow(noise(vec2(ang*38. + 3., t*1.6)), 4.);
  float rays = (r1*0.9 + r2*0.7)*smoothstep(1.35, 0.1, dist)*smoothstep(0.85, 0.05, abs(ang));
  col += mix(uPal[0], uPal[2], 0.5 + 0.5*sin(ang*3.))*rays*(0.45 + 0.75*uGlow + 0.3*uFlow);
  col += mix(uPal[2], vec3(1.), 0.6)*(0.02/(dist*dist + 0.02))*0.3*(0.6 + 0.5*uGlow);
  float cl = fbm(vec2(p.x*2.0 + t*0.5, p.y*4.0 - t*0.15));
  float band = smoothstep(0.0, 0.22, p.y)*smoothstep(0.56, 0.36, p.y);
  float gap = smoothstep(0.05, 0.4, abs(p.x));
  float dens = smoothstep(0.45, 0.68, cl)*band*gap*uParam.y;
  float rim = (smoothstep(0.42, 0.52, cl) - smoothstep(0.52, 0.66, cl))*band*gap*uParam.y;
  col *= 1. - dens*0.92;
  col += mix(uPal[2], vec3(1.), 0.5)*rim*0.35*(0.4 + uGlow)*smoothstep(1.4, 0.2, abs(p.x));
  for(int l=0;l<2;l++){ float fl = float(l); float sc = 18. - fl*7.;
    vec2 q = p*sc; q.y -= uTravel*(0.25 + fl*0.12)*sc*0.15; vec2 id = floor(q); vec2 f = fract(q) - 0.5; vec2 h = hash22(id + fl*9.);
    if(h.x < 0.2 + uParam.z*0.4){ vec2 o = (h - 0.5)*0.6 + vec2(0.15*sin(uTime*0.7 + h.y*9.), 0.); float dd = length(f - o);
      col += uPal[2]*(0.004/(dd*dd*sc*0.4 + 0.004))*0.07*(0.5 + 0.5*sin(uTime*2. + h.x*30.))*(0.6 + uGlow)*smoothstep(0.5, 0.15, dd); } }
  if(uParam.x > 0.5){
    vec2 q = p - vec2(0., -0.04);
    float cr = min(sdBox(q, vec2(0.022, 0.25)), sdBox(q - vec2(0., 0.09), vec2(0.13, 0.022)));
    float k = 0.8 + 0.6*uGlow + 0.6*uHit;
    col *= smoothstep(-0.004, 0.03, cr)*0.7 + 0.3;
    col += vec3(1., 0.95, 0.85)*smoothstep(0.003, -0.003, cr)*1.5*k;
    col += uPal[2]*0.0016/(max(cr, 0.)*max(cr, 0.)*25. + 0.0016)*0.3*k;
    float a2 = atan(q.y - 0.09, q.x); float rr = length(q - vec2(0., 0.09));
    col += uPal[0]*pow(0.5 + 0.5*sin(a2*16. + uBeat*0.1), 12.)*exp(-rr*3.)*0.3*k;
  }
  return col;
}`);
scene('panels', { name: 'Panel Lights', cat: 'Lights', speed: 'fast', palette: 'classic', mode: 'same', perDoor: true, cells: true, companion: 'panels', family: ['bulbs', 'beams'],
  params: [{ name: 'Border', def: 0.5 }, { name: 'Color shift', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec2 q = uv*uGrid; vec2 id = floor(q); vec2 f = fract(q);
  vec2 cs = vec2(uAspect/uGrid.x, 1./uGrid.y);
  vec2 lp = (f-0.5)*cs;
  float m = 0.006 + uParam.x*0.02;
  float d = sdRBox(lp, cs*0.5 - m, 0.01);
  float v = cellv(int(id.y)*int(uGrid.x) + int(id.x));
  float shift = floor(uBar*0.5)*uParam.y;
  vec3 c = pal((id.x + id.y*2.)*0.25 + shift*0.25);
  float fill = smoothstep(0.003, -0.003, d);
  float center = 1. - 0.35*smoothstep(0., 0.6, length(lp/(cs*0.5)));
  float rim = exp(-abs(d)*150.)*0.9;
  vec3 col = c*v*(fill*center*1.1 + rim*0.7);
  col += mix(c, vec3(1.), 0.3)*fill*uFlash*(0.03 + 0.2*v);
  col += c*0.02*rim;
  return col;
}`);

scene('bulbs', { name: 'Bulb Wall', cat: 'Lights', speed: 'fast', palette: 'classic', mode: 'same', perDoor: true, cells: true, companion: 'bulbs', family: ['panels', 'beams'],
  params: [{ name: 'Bulb size', def: 0.5 }, { name: 'Colors: stripes/alt/rainbow', def: 0 }, { name: 'Twinkle', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  float rows = 6. + floor((1.-uParam.x)*5.); float s = 1./rows;
  vec2 g = (p + vec2(uAspect*0.5, 0.5))/s; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float cols = floor(uAspect*rows);
  if(id.x >= cols) return vec3(0.);
  vec2 cuv = (id + 0.5)/vec2(cols, rows);
  float v = cellAt(cuv);
  float mode = uParam.y;
  vec3 c = mode < 0.33 ? pal(id.x*0.25) : mode < 0.66 ? pal(mod(id.x + id.y, 2.)*0.5 + floor(uBeat)*0.25) : hsv(fract(id.x*0.04 + id.y*0.02 - uBeat*0.0625), 0.9, 1.);
  float tw = 1. - uParam.z*0.5*hash12(id + floor(uTime*6.));
  float spark = 0.;
  for(int i=0;i<3;i++){ vec4 e = uAccEv[i]; if(e.x>0.5) continue; if(hash12(id + e.z*91.) < 0.08) spark += exp(-e.x*8.)*e.y; }
  vec2 fb = f*vec2(1.25, 1.) + vec2(0., 0.04);
  float r = 0.24;
  float d = length(fb);
  float core = smoothstep(r, r*0.3, d);
  float halo = 0.04/(d*d*1.4 + 0.04)*smoothstep(0.8, 0.25, d)*1.6;
  float b = v*tw;
  vec3 col = c*(core*1.6 + halo*0.25)*b + vec3(1.)*core*spark*1.5;
  col += mix(c, vec3(1.), 0.7)*core*uFlash*0.4*v;
  col += c*0.015*smoothstep(r*1.25, r, d);
  return col;
}`);

scene('beams', { name: 'Stage Beams', cat: 'Lights', speed: 'fast', palette: 'royal', mode: 'same', perDoor: true, cells: true, companion: 'beams', family: ['panels', 'fireworks'],
  params: [{ name: 'Sweep', def: 0.6 }, { name: 'Haze', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = uGrid.x;
  float haze = mix(1., 0.55 + 0.8*fbm3(p*3. + vec2(uTravel*0.06, -uTravel*0.04)), uParam.y);
  for(int i=0;i<16;i++){ float fi = float(i); if(fi >= n) break;
    float bx = ((fi+0.5)/n - 0.5)*uAspect*0.92;
    vec2 base = vec2(bx, -0.52);
    float sw = 0.12 + uParam.x*0.45;
    float side = mod(fi, 2.) < 1. ? 1. : -1.;
    float ang = side*sin(uBeat*PI*0.25*uSpeed + fi*0.4)*sw*0.8 + sin(uBar*PI*0.5 + fi)*sw*0.3;
    vec2 dir = vec2(sin(ang), cos(ang));
    vec2 rel = p - base; float along = dot(rel, dir); float perp = dot(rel, vec2(dir.y, -dir.x));
    float w = 0.008 + along*(0.055 + 0.04*uHit);
    float core = exp(-pow(perp/max(w*0.35, 1e-4), 2.));
    float beam = (smoothstep(w, w*0.1, abs(perp))*0.6 + core*0.6)*smoothstep(0., 0.03, along)*exp(-along*0.7);
    float v = max(cellAt(vec2((fi+0.5)/n, 0.5)), cellAt(vec2((fi+0.5)/n, 0.1)));
    v = 0.1 + 0.9*v;
    vec3 c = mix(pal(fi*0.25 + floor(uBar*0.25)*0.25), vec3(1.), 0.2 + 0.4*uFlash);
    col += c*beam*v*haze*1.25;
    vec2 lp = p - base - dir*0.03; col += mix(c, vec3(1.), 0.5)*v*0.0004/(dot(lp,lp) + 0.0004)*0.9;
  }
  col += pal(uBar*0.125)*exp(-(p.y+0.5)*10.)*0.05*haze*(0.3+uGlow);
  return col;
}`);

scene('snowflake', { name: 'Giant Snowflake', cat: 'Big motion', speed: 'any', palette: 'icy', mode: 'same', companion: 'snowflake', family: ['snowstorm', 'liquid'],
  params: [{ name: 'Detail', def: 0.5 }, { name: 'Small flakes', def: 0.5 }] }, `
float flake(vec2 p, float R, float seed, float grow){
  float r = length(p); float a = atan(p.y, p.x);
  a = mod(a, PI/3.) - PI/6.; a = abs(a);
  vec2 q = r*vec2(cos(a), sin(a));
  float d = sdSeg(q, vec2(0.), vec2(R, 0.)) - R*0.012;
  float nb = 3. + floor(uParam.x*3.);
  for(int k=1;k<7;k++){ float fk = float(k); if(fk > nb) break;
    float x = R*fk/(nb+1.); float L = R*(0.42 - fk*0.05)*(0.6 + 0.5*hash11(seed*7. + fk))*grow;
    d = min(d, sdSeg(q, vec2(x, 0.), vec2(x, 0.) + L*vec2(0.5, 0.866)) - R*0.008);
    float L2 = L*0.4;
    vec2 m = vec2(x, 0.) + L*0.55*vec2(0.5,0.866);
    d = min(d, sdSeg(q, m, m + L2*vec2(1., 0.)) - R*0.005);
  }
  float hexd = max(abs(q.y)*1.1547, abs(q.x*0.5 + q.y*0.866)) ;
  d = min(d, abs(length(q) - R*0.18) - R*0.006);
  return d;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.0003,0.001,0.003);
  col += uPal[1]*0.015*pow(fbm(p*6. + uTravel*0.02), 4.);
  float R = 0.4*(0.88 + 0.1*uGlow + 0.1*uHit);
  vec2 q = rot(uBeat*0.04*uSpeed)*p;
  float d = flake(q, R, floor(uLevel) + 1., 0.8 + 0.4*uFlow);
  vec3 ic = mix(uPal[0], vec3(1.), 0.5);
  col += ic*(smoothstep(0.003, 0.0, d)*1.3 + 0.0012/(d*d*30. + 0.0012)*0.35*(0.7+uGlow));
  col += uPal[2]*exp(-length(p)*7.)*0.25*(0.5+uHit);
  for(int i=0;i<4;i++){ vec4 e = uHitEv[i]; if(e.x>1.8) continue; float rr = R*0.3 + e.x*0.7;
    vec2 qq = rot(PI/6.)*p; float hx = max(abs(qq.x)*0.866 + abs(qq.y)*0.5, abs(qq.y));
    col += uPal[1]*exp(-pow((hx - rr)*70., 2.))*exp(-e.x*2.)*e.y*0.7; }
  if(uParam.y > 0.1){
    for(int i=0;i<6;i++){ float fi = float(i); float h = hash11(fi*3.7);
      vec2 c = vec2((fract(h + uTravel*0.01*(0.5+h)) - 0.5)*uAspect*1.1, fract(hash11(fi*9.1) - uTravel*0.03*(0.6+h)) - 0.5);
      float sR = (0.05 + 0.05*hash11(fi*5.3))*uParam.y*1.6;
      float dd = flake(rot(uTime*0.2*(h-0.5))*(p - c), sR, fi, 1.);
      col += ic*0.6*(smoothstep(0.002, 0., dd) + 0.0004/(dd*dd*40.+0.0004)*0.25); }
  }
  return col;
}`);

scene('liquid', { name: 'Liquid Light', cat: 'Simulation', speed: 'any', palette: 'aurora', mode: 'span', companion: 'liquid', family: ['ribbons', 'warp'],
  params: [{ name: 'Scale', def: 0.5 }, { name: 'Filaments', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec2 q = p*(1.0 + uParam.x*1.6);
  float t = uTravel*0.09;
  for(int i=0;i<3;i++){ vec4 e = uHitEv[i]; if(e.x>1.5) continue; vec2 c = vec2((e.z-0.5)*uAspect*0.6, (hash11(e.z*7.)-0.5)*0.5);
    vec2 d = p - c; float r = length(d); float w = exp(-pow((r - e.x*0.9)*9., 2.))*exp(-e.x*2.)*e.y;
    q += normalize(d + 1e-4)*w*0.12; }
  vec2 w1 = vec2(fbm(q + vec2(0., t)), fbm(q + vec2(5.2, 1.3 - t)));
  vec2 w2 = vec2(fbm(q + 3.*w1 + vec2(1.7, 9.2) + t*0.6), fbm(q + 3.*w1 + vec2(8.3, 2.8) - t*0.4));
  float f = fbm(q + 3.5*w2);
  float ridge = pow(1. - abs(2.*f - 1.), 6. + uParam.y*10.);
  vec3 c = mix(uPal[0], uPal[1], clamp(length(w1)*1.2 - 0.3, 0., 1.));
  c = mix(c, uPal[2], clamp(w2.x*w2.x*1.8, 0., 1.));
  c = mix(c, uPal[3], clamp(pow(w2.y, 3.)*2., 0., 1.)*0.6);
  vec3 col = c*(ridge*(0.5 + 0.6*uGlow + 0.45*uHit) + pow(f, 6.)*0.15*(0.5+uFlow));
  return col;
}`);

scene('galaxy', { name: 'Galaxy', cat: 'Stars', speed: 'slow', palette: 'royal', mode: 'same', companion: 'starfield', family: ['starfield', 'warp'],
  params: [{ name: 'Arms', def: 0.3 }, { name: 'Tilt', def: 0.5 }] }, STARS_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.001,0.001,0.006);
  col += vec3(0.8,0.85,1.)*starLayer(p, 50., 0.8, 3.)*0.6;
  vec2 q = rot(0.35)*p; q.y *= 1.4 + uParam.y*1.4;
  float r = length(q); float a = atan(q.y, q.x);
  float rotA = uTravel*0.05;
  float arms = 2. + floor(uParam.x*3.);
  float ph = a - log(r + 0.03)*2.4 + rotA;
  float spiral = pow(0.5 + 0.5*cos(arms*ph), 3.);
  float dust = fbm(rot(rotA*0.5)*q*7.);
  float disk = exp(-r*3.2);
  float dens = spiral*disk*(0.4 + 0.8*dust);
  vec3 armc = mix(uPal[2], uPal[0], smoothstep(0.05, 0.5, r));
  col += armc*dens*(0.55 + 0.6*uGlow);
  col *= 1. - 0.6*smoothstep(0.55, 0.75, dust)*spiral*smoothstep(0.03,0.15,r);
  vec2 sq = rot(rotA*1.2/(r + 0.25))*q;
  vec2 g = sq*70.; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float h = hash12(id);
  float star = step(0.82, h)*0.0009/(dot(f,f)*0.02 + 0.0009)*0.02*spiral*disk*4.;
  col += mix(vec3(1.), uPal[1], hash12(id+7.))*star*(0.7 + 0.8*uAcc);
  float core = exp(-r*16.)*1.4 + exp(-r*5.)*0.3;
  col += mix(uPal[1], vec3(1.,0.95,0.85), 0.6)*core*(0.7 + 0.5*uGlow + 0.8*uHit);
  return col;
}`);

scene('ribbons', { name: 'Ribbons of Light', cat: 'Big motion', speed: 'any', palette: 'candy', mode: 'span', companion: 'ribbons', family: ['liquid', 'fireworks'],
  params: [{ name: 'Ribbons', def: 0.5 }, { name: 'Width', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = 3. + floor(uParam.x*5.);
  float t = uTravel*0.45;
  float amp = 0.18*(1. + 0.35*uHit + 0.25*uFlow);
  for(int i=0;i<8;i++){ float fi = float(i); if(fi >= n) break;
    float off = (fi/(n-1.+1e-3) - 0.5)*0.55;
    float x = p.x;
    float y = off*0.7 + amp*sin(x*1.4 + t*(0.7 + 0.13*fi) + fi*1.7)*(0.6 + 0.4*sin(x*0.6 - t*0.35 + fi*2.3));
    float tw = sin(x*2.3 + t*1.1 + fi*2.);
    float w = (0.006 + 0.03*abs(tw))*(0.5 + uParam.y)*(0.7 + 0.5*uGlow);
    float d = abs(p.y - y);
    vec3 c = pal(fi/n + t*0.02);
    float body = exp(-pow(d/max(w,1e-4), 2.));
    float edge = exp(-pow((d - w)/0.003, 2.))*0.5;
    float shade = 0.55 + 0.45*tw;
    col += c*(body*shade*0.9 + edge*0.6) + c*0.0008/(d*d + 0.0008)*0.06;
  }
  return col;
}`);

scene('ornaments', { name: 'Ornaments', cat: 'Christmas', speed: 'any', palette: 'classic', mode: 'span', companion: 'ornaments', cells: true, family: ['tree', 'bulbs'],
  params: [{ name: 'Count', def: 0.5 }, { name: 'Swing', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(2., floor(uAspect*(1.8 + uParam.x*1.6)));
  for(int k=-1;k<=1;k++){
    float i = floor((p.x/uAspect + 0.5)*n) + float(k);
    if(i < 0. || i >= n) continue;
    float h = hash11(i*3.7 + 1.);
    float px = ((i + 0.5)/n - 0.5)*uAspect;
    vec2 pivot = vec2(px, 0.52);
    float L = 0.32 + 0.38*h;
    float sw = sin(uBeat*PI*0.5 + i*1.3)*(0.03 + 0.09*uParam.y)*(0.5 + uFlow);
    vec2 dir = vec2(sin(sw), -cos(sw));
    float R = min(0.06 + 0.05*hash11(i*5.1), uAspect/n*0.42);
    vec2 c = pivot + dir*L;
    col += vec3(0.5,0.45,0.35)*0.25*smoothstep(0.0025, 0., sdSeg(p, pivot, c - dir*R*1.1));
    vec2 cap = c - dir*R*1.05; float capd = sdBox(rot(-sw)*(p - cap), vec2(R*0.22, R*0.14));
    col = mix(col, vec3(0.9,0.7,0.3)*0.6, smoothstep(0.002, -0.002, capd));
    vec2 q = (p - c)/R; float rr = dot(q,q);
    float v = cellAt(vec2((i + 0.5)/n, 0.5));
    vec3 base = pal(i*0.25 + floor(i/4.)*0.13);
    col += base*0.0035/(max(length(p-c)-R, 0.)*max(length(p-c)-R,0.)*30. + 0.0035)*0.12*v*(0.6+uGlow);
    if(rr < 1.){
      vec3 nrm = vec3(q, sqrt(1. - rr));
      vec3 ld = normalize(vec3(-0.4, 0.6, 0.7));
      float diff = max(dot(nrm, ld), 0.);
      float spec = pow(max(dot(reflect(-ld, nrm), vec3(0,0,1)), 0.), 40.);
      float band = smoothstep(0.03, 0., abs(q.y + 0.1*sin(q.x*6. + i))-0.08)*0.5;
      float glit = step(0.93, hash12(floor(q*18.) + floor(uTime*8.)))*band;
      vec3 c2 = base*(0.12 + 0.9*diff)*(0.25 + 0.75*v)*(0.8 + 0.4*uGlow) + vec3(1.)*spec*0.9*(0.4+0.6*v) + vec3(1.,0.9,0.6)*(band*0.25 + glit)*v;
      c2 += base*v*uHit*0.5;
      col = mix(col, c2, smoothstep(1., 0.96, rr));
    }
  }
  return col;
}`);

scene('icicles', { name: 'Icicle Lights', cat: 'Lights', speed: 'any', palette: 'icy', mode: 'span', companion: 'icicles', family: ['snowstorm', 'bulbs'],
  params: [{ name: 'Drops', def: 0.5 }, { name: 'Meteor drips', def: 0.7 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = floor(uAspect*(9. + uParam.x*10.));
  float xs = (p.x/uAspect + 0.5)*n; float i = floor(xs); float lx = (fract(xs) - 0.5)*uAspect/n;
  float pat = mod(i, 5.); float leds = pat == 0. ? 4. : pat == 1. ? 7. : pat == 2. ? 10. : pat == 3. ? 6. : 8.;
  leds += floor(hash11(i*1.31)*3.);
  float sp = 0.042; float top = 0.47; float y = top - p.y;
  float len = leds*sp;
  col += vec3(0.6,0.7,0.8)*0.04*exp(-abs(p.y - top - 0.008)*600.);
  if(y < -0.02 || y > len + 0.03) return col;
  col += vec3(0.6,0.7,0.8)*0.03*exp(-abs(lx)*1500.)*step(0., y)*step(y, len);
  float k = clamp(floor(y/sp + 0.5), 1., leds); float ly = y - k*sp;
  float d = length(vec2(lx, ly));
  float led = 0.00006/(d*d + 0.00006);
  float base = 0.3 + 0.15*sin(uTime*(1.5 + hash11(i)*2.) + k*1.3 + i);
  float met = 0.;
  for(int e=0;e<6;e++){ vec4 ev = uHitEv[e]; if(ev.x > 1.6) continue;
    float delay = (uParam.y > 0.5 ? abs(i/n - 0.5)*0.35 : 0.) + hash11(i*3.3 + ev.z)*0.12;
    float head = (ev.x - delay)*(1.2 + leds*0.12)/sp;
    float dd = head - k;
    met += (dd >= 0. ? exp(-dd*0.55) : exp(dd*4.))*ev.y*step(0., ev.x - delay)*step(dd, leds + 3.);
  }
  float acc = 0.; for(int e=0;e<3;e++){ vec4 ev = uAccEv[e]; if(ev.x > 0.4) continue; if(hash12(vec2(i, k) + ev.z*13.) < 0.12) acc += exp(-ev.x*10.)*ev.y; }
  vec3 c = mix(vec3(0.82,0.9,1.), pal(i*0.07), 0.3);
  float b = base*(0.45 + 0.6*uGlow) + met*1.6 + acc*1.5;
  col += c*led*b;
  return col;
}`);

scene('trace', { name: 'Neon Trace', cat: 'Lights', speed: 'fast', palette: 'candy', mode: 'same', perDoor: true, cells: true, companion: 'trace', family: ['panels', 'beams'],
  params: [{ name: 'Line width', def: 0.4 }, { name: 'Runners', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec2 q = uv*uGrid; vec2 id = floor(q); vec2 f = fract(q);
  vec2 cs = vec2(uAspect/uGrid.x, 1./uGrid.y);
  vec2 lp = (f - 0.5)*cs;
  float inset = 0.012;
  float d = abs(sdRBox(lp, cs*0.5 - inset, 0.02));
  float w = 0.0015 + uParam.x*0.004;
  float v = cellv(int(id.y)*int(uGrid.x) + int(id.x));
  vec3 c = pal((id.x + id.y)*0.25 + floor(uBar*0.5)*0.25);
  float line = exp(-pow(d/w, 2.)) + 0.25*exp(-d*60.);
  vec3 col = c*line*(0.08 + 1.1*v);
  float per = 2.*(cs.x + cs.y);
  vec2 a = lp + cs*0.5;
  float s = a.y < inset*2. ? a.x : a.x > cs.x - inset*2. ? cs.x + a.y : a.y > cs.y - inset*2. ? cs.x + cs.y + (cs.x - a.x) : 2.*cs.x + cs.y + (cs.y - a.y);
  float ph = fract(s/per - uBar - (id.x + id.y)*0.07);
  float run = exp(-ph*14.)*uParam.y;
  col += mix(c, vec3(1.), 0.5)*exp(-pow(d/(w*1.6), 2.))*run*(0.6 + 1.2*uGlow);
  col += mix(c, vec3(1.), 0.7)*exp(-pow(d/w, 2.))*uFlash*0.8;
  return col;
}`);

const SCENE_ORDER = ['bethlehem', 'starfield', 'glory', 'rosewindow', 'candles', 'galaxy', 'aurora', 'snowstorm', 'snowflake', 'fireworks', 'warp', 'liquid', 'ribbons', 'tree', 'ornaments', 'icicles', 'panels', 'trace', 'bulbs', 'beams'];
