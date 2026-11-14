/* Scene library, part 2: DJ lights, bright Christmas lights, stars, angels & faith, winter.
   Same contract as scenes.js. Extra uniforms: uBand0 (kick hit, bass, drums, snare hit), uBand1 (melody, vocals, hats hit, loudness). */
Object.assign(PALETTES, {
  laser: { name: 'Laser', c: ['#00ff3c', '#ff1430', '#1e8cff', '#00ffd2'] },
  club: { name: 'Club', c: ['#ff1fb4', '#1fe0ff', '#5a3bff', '#ffffff'] },
  c9: { name: 'C9 Classic', c: ['#ff2a1a', '#18c048', '#2a5bff', '#ff9a1a'] },
  gold: { name: 'Angel Gold', c: ['#ffd27a', '#fff3d6', '#ffb347', '#ffe9b0'] },
});

const FIG_GLSL = `
float sdEll(vec2 p, vec2 c, vec2 r, float a){ vec2 q = rot(-a)*(p - c); return (length(q/r) - 1.)*min(r.x, r.y); }
float lineGlow(float d, float w){ return exp(-(d*d)/(w*w)) + 0.07*exp(-abs(d)/(w*5.)); }
float sdTrap(vec2 p, float y0, float y1, float w0, float w1){ float f = clamp((p.y - y0)/(y1 - y0), 0., 1.); return max(max(y0 - p.y, p.y - y1), abs(p.x) - mix(w0, w1, f)); }
`;
const ANGEL_GLSL = FIG_GLSL + `
// angel facing right (trumpet to +x). returns body outline distance; halo distance in h
float angelSD(vec2 q, float flap, float trumpet, out float h, out float bell){
  float d = sdTrap(q, -0.44, 0.06, 0.15, 0.05);
  d = min(d, length(q - vec2(0., 0.125)) - 0.05);
  h = abs(length((q - vec2(0., 0.215))*vec2(1., 3.4)) - 0.062)*0.5;
  float wing = 1e3;
  for(int s=0;s<2;s++){ float sd = s == 0 ? -1. : 1.;
    for(int k=0;k<5;k++){ float fk = float(k);
      float a = 0.85 + fk*0.24 + flap*0.25*(1. - fk*0.15);
      float L = 0.44 - fk*0.06;
      vec2 base = vec2(sd*0.04, 0.02);
      vec2 dir = vec2(sd*cos(a), sin(a));
      vec2 c = base + dir*L*0.5;
      wing = min(wing, sdEll(q, c, vec2(L*0.5, 0.034 - fk*0.002), atan(dir.y, dir.x)));
    } }
  d = min(d, wing);
  bell = 1e3;
  if(trumpet > 0.5){
    d = min(d, sdSeg(q, vec2(0.045, 0.11), vec2(0.24, 0.17)) - 0.006);
    d = min(d, sdSeg(q, vec2(0.03, 0.0), vec2(0.075, 0.11)) - 0.008);
    bell = length(q - vec2(0.25, 0.173)) - 0.026;
    d = min(d, bell);
  }
  return d;
}`;

scene('lasers', { name: 'Laser Show', cat: 'DJ Lights', speed: 'fast', palette: 'laser', mode: 'same', companion: 'scanners', family: ['scanners', 'strobe'], cells: true,
  params: [{ name: 'Beams', def: 0.5 }, { name: 'Sweep', def: 0.6 }, { name: 'Haze', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = 6. + floor(uParam.x*12.);
  float haze = mix(1., 0.45 + 0.9*fbm3(p*2.4 + vec2(uTravel*0.05, -uTravel*0.03)), uParam.z);
  vec2 o = vec2(0., 0.62);
  float spread = 0.7 + 0.45*sin(uBar*PI*0.5) + 0.35*uHit;
  float sweep = 0.55*uParam.y*sin(uBeat*PI*0.25*uSpeed);
  float lastIdx = uHitEv[0].w;
  float jump = (hash11(lastIdx*3.7) - 0.5)*0.5*smoothstep(0., 0.08, uHitEv[0].x)*step(uHitEv[0].x, 60.);
  for(int i=0;i<18;i++){ float fi = float(i); if(fi >= n) break;
    float a = -PI*0.5 + spread*(fi/(n - 1.) - 0.5) + sweep + jump;
    vec2 d = vec2(cos(a), sin(a));
    vec2 r = p - o; float t = dot(r, d); if(t < 0.) continue;
    float perp = abs(r.x*d.y - r.y*d.x);
    float v = 0.15 + 0.85*cellAt(vec2((fi + 0.5)/n, 0.5));
    float flick = 0.75 + 0.25*sin(uTime*60. + fi*2.1)*uBand1.z;
    float core = exp(-(perp*perp)/(0.0016*0.0016));
    float glow = 0.00003/(perp*perp + 0.00003)*smoothstep(0.03, 0., perp);
    vec3 c = palc(int(mod(fi, 4.)));
    col += c*(core*1.6 + glow*0.35*haze)*v*flick*(0.8 + 0.6*uGlow);
  }
  float fanA = atan(p.y - o.y, p.x - o.x) + PI*0.5 - sweep - jump;
  col += uPal[0]*0.025*uAcc*haze*step(abs(fanA), spread*0.5)*smoothstep(1.4, 0.2, length(p - o));
  col += mix(uPal[3], vec3(1.), 0.5)*0.0006/(dot(p - o, p - o) + 0.0006)*(0.6 + uHit)*smoothstep(0.3, 0., length(p - o));
  return col;
}`);

scene('movingheads', { name: 'Moving Heads', cat: 'DJ Lights', speed: 'fast', palette: 'club', mode: 'same', companion: 'movingheads', family: ['lasers', 'scanners'], cells: true,
  params: [{ name: 'Movement', def: 0.6 }, { name: 'Gobo size', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = floor(uAspect*2.2) + 1.;
  for(int i=0;i<8;i++){ float fi = float(i); if(fi >= n) break;
    vec2 F = vec2(((fi + 0.5)/n - 0.5)*uAspect*0.9, 0.47);
    float m = uParam.x;
    vec2 T = vec2(F.x*0.5 + uAspect*0.28*m*sin(uBeat*PI*0.25 + fi*1.3), -0.2 + 0.18*m*sin(uBeat*PI*0.125*1.5 + fi*2.1));
    vec2 dir = normalize(T - F); float L = length(T - F);
    vec2 r = p - F; float t = clamp(dot(r, dir), 0., L); float perp = length(r - dir*t);
    float v = 0.2 + 0.8*cellAt(vec2((fi + 0.5)/n, 0.5));
    vec3 c = pal(fi*0.25 + floor(uBar)*0.37);
    float w = 0.004 + t*0.07;
    float beam = smoothstep(w, w*0.2, perp)*smoothstep(0., 0.05, t)*0.28;
    float sz = (0.06 + 0.05*uParam.y)*(1. + 0.25*uHit);
    vec2 q = p - T; float rr = length(q)/sz;
    float ang = atan(q.y, q.x) + uBeat*PI*0.25;
    float gobo = smoothstep(1.02, 0.95, rr)*(0.35 + 0.65*step(0.45, fract(ang*6./TAU))*step(0.25, rr)) + smoothstep(0.2, 0.1, rr);
    gobo *= 1. - smoothstep(0.62, 0.68, rr)*smoothstep(0.78, 0.72, rr);
    col += c*(beam + gobo*1.5)*v*(0.7 + 0.6*uGlow + 0.5*uHit);
    vec2 fq = p - F; col += mix(c, vec3(1.), 0.6)*v*0.0005/(dot(fq, fq) + 0.0005)*smoothstep(0.08, 0., length(fq));
    col += vec3(0.25)*smoothstep(0.03, 0.025, length(fq - vec2(0., 0.02)))*0.05;
  }
  return col;
}`);

scene('strobe', { name: 'Blinders & Strobes', cat: 'DJ Lights', speed: 'fast', palette: 'club', mode: 'same', perDoor: false, companion: 'strobe', family: ['lasers', 'eqbars'],
  params: [{ name: 'Strobe amount', def: 0.5 }, { name: 'Blinders', def: 0.7 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float cols = floor(uAspect*3.); float rows = 3.;
  vec2 g = vec2((p.x/uAspect + 0.5)*cols, (p.y + 0.5)*rows*0.66);
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  if(g.y >= 0. && g.y < rows*0.66*0.999 && id.y < 2.){
    float box = smoothstep(0.02, -0.02, sdRBox(f, vec2(0.42, 0.4), 0.06));
    float fl = 0.;
    for(int k=0;k<6;k++){ vec4 e = uHitEv[k]; if(e.x > 0.4) continue; if(hash12(id + e.z*17.3) < 0.25 + uParam.x*0.4) fl = max(fl, exp(-e.x*16.)*e.y); }
    float led = 0.6 + 0.4*step(0.5, fract((f.x + f.y)*14.));
    vec3 wash = pal(id.x*0.17 + floor(uBar)*0.25)*0.018*(0.3 + uBand0.y);
    col += box*(vec3(1.)*fl*1.8*led + wash);
  }
  float nb = floor(uAspect*3.5);
  float bx = (p.x/uAspect + 0.5)*nb; float bi = floor(bx); vec2 bq = vec2((fract(bx) - 0.5)*uAspect/nb, p.y - 0.3);
  float bl = 0.;
  for(int k=0;k<4;k++){ vec4 e = uAccEv[k]; if(e.x > 0.6) continue; if(mod(bi + floor(e.z*7.), 2.) < 1.) bl = max(bl, exp(-e.x*7.)*e.y); }
  bl = bl*uParam.y;
  float lamp = length(bq);
  col += vec3(1., 0.72, 0.38)*(smoothstep(0.055, 0.045, lamp)*(0.06 + 2.2*bl) + 0.0015/(lamp*lamp + 0.0015)*bl*0.8*smoothstep(0.2, 0., lamp));
  col += vec3(0.12, 0.09, 0.06)*smoothstep(0.075, 0.07, lamp)*smoothstep(0.055, 0.06, lamp);
  col += vec3(1.)*uFlash*0.12;
  return col;
}`);

scene('discoball', { name: 'Mirror Ball', cat: 'DJ Lights', speed: 'any', palette: 'club', mode: 'same', companion: 'discoball', family: ['movingheads', 'twinkle'],
  params: [{ name: 'Spots', def: 0.6 }, { name: 'Color', def: 0.4 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float rotv = uTravel*0.18;
  for(int l=0;l<2;l++){ float fl = float(l);
    float sc = 11. + fl*6.;
    vec2 q = vec2(p.x + rotv*(0.7 + fl*0.35), p.y)*sc;
    vec2 id = floor(q); vec2 f = fract(q) - 0.5; vec2 h = hash22(id + fl*13.);
    if(h.x < 0.35 + uParam.x*0.5){
      vec2 o = (h - 0.5)*0.5; float d = length((f - o)*vec2(1., 1.25));
      float tw = 0.6 + 0.4*sin(uTime*6. + h.y*30.);
      vec3 c = mix(vec3(1.), pal(h.y + floor(uBar)*0.25), uParam.y);
      col += c*smoothstep(0.16, 0.08, d)*tw*(0.45 + 0.6*uGlow + 0.8*uHit)*(fl == 0. ? 1. : 0.6);
    }
  }
  vec2 bc = vec2(0., 0.3); float R = 0.11; vec2 b = p - bc; float r = length(b);
  col *= smoothstep(R*0.9, R*1.6, r);
  if(r < R){
    vec3 nrm = vec3(b/R, sqrt(max(0., 1. - dot(b, b)/(R*R))));
    float lon = atan(nrm.x, nrm.z) + rotv*2.; float lat = asin(clamp(nrm.y, -1., 1.));
    vec2 fid = floor(vec2(lon*5., lat*7.));
    vec2 ff = fract(vec2(lon*5., lat*7.)) - 0.5;
    float facet = 0.25 + 0.5*nrm.z + 0.7*step(0.88, hash12(fid + floor(uTime*8.)))*(0.6 + uAcc);
    facet *= smoothstep(0.5, 0.42, max(abs(ff.x), abs(ff.y)));
    col += vec3(0.85, 0.9, 1.)*facet*0.55;
  }
  col += vec3(1.)*0.0006/(r*r + 0.0006)*smoothstep(0.35, 0.1, r)*(0.3 + uHit);
  col += vec3(0.5)*smoothstep(0.002, 0., abs(p.x))*step(bc.y + R, p.y)*0.1;
  return col;
}`);

scene('eqbars', { name: 'LED Spectrum', cat: 'DJ Lights', speed: 'fast', palette: 'club', mode: 'same', companion: 'eqbars', family: ['strobe', 'tunnel'],
  params: [{ name: 'Bars', def: 0.5 }, { name: 'Rainbow', def: 0.3 }] }, `
float band(float x){
  float k[7]; k[0] = uBand0.x; k[1] = uBand0.y; k[2] = uBand0.z; k[3] = uBand0.w; k[4] = uBand1.x; k[5] = uBand1.y; k[6] = uBand1.z;
  float fx = clamp(x, 0., 1.)*6.; int i = int(floor(fx)); float f = fract(fx);
  float a = k[0], b = k[0];
  for(int j=0;j<7;j++){ if(j == i) a = k[j]; if(j == min(i + 1, 6)) b = k[j]; }
  return mix(a, b, f);
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float nb = floor(uAspect*(5. + uParam.x*6.)); if(mod(nb, 2.) < 1.) nb += 1.;
  float bx = (p.x/uAspect + 0.5)*nb; float bi = floor(bx); float fx = fract(bx) - 0.5;
  float cdist = abs(bi - (nb - 1.)*0.5)/((nb - 1.)*0.5);
  float v = band(cdist)*(0.85 + 0.25*noise(vec2(bi*3.1, uTime*5.)));
  v = clamp(v*(0.75 + 0.35*uGlow), 0., 1.);
  float rows = 16.; float y = (p.y + 0.46)/0.92; float ri = floor(y*rows); float fy = fract(y*rows) - 0.5;
  if(y < 0. || y > 1.) return col;
  float dot2 = smoothstep(0.42, 0.3, max(abs(fx)*1.25, abs(fy)));
  float lvl = (ri + 0.5)/rows;
  float on = step(lvl, v);
  float peak = step(abs(lvl - min(1., v + 0.07)), 0.5/rows);
  vec3 c = mix(mix(vec3(0.1, 1., 0.35), vec3(1., 0.85, 0.1), smoothstep(0.45, 0.7, lvl)), vec3(1., 0.15, 0.1), smoothstep(0.75, 0.9, lvl));
  c = mix(c, pal(cdist*0.8 + uBeat*0.03), uParam.y);
  col += c*dot2*(on*1.25 + peak*1.6 + 0.03);
  return col;
}`);

scene('scanners', { name: 'Beam Fans', cat: 'DJ Lights', speed: 'fast', palette: 'royal', mode: 'same', companion: 'scanners', family: ['lasers', 'movingheads'],
  params: [{ name: 'Beams', def: 0.5 }, { name: 'Snap on hits', def: 0.8 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = 3. + floor(uParam.x*5.);
  float idx = uHitEv[0].w; float age = uHitEv[0].x;
  float e = smoothstep(0., 0.12, age);
  float snap = mix(hash11(idx - 1. + 0.37), hash11(idx + 0.37), e)*uParam.y;
  for(int s=0;s<2;s++){ float sd = s == 0 ? -1. : 1.;
    vec2 o = vec2(sd*uAspect*0.5, -0.52);
    for(int i=0;i<8;i++){ float fi = float(i); if(fi >= n) break;
      float a = PI*0.5 + sd*(0.2 + fi*0.12 + 0.22*sin(uBeat*PI*0.25*uSpeed + sd) + snap*0.45);
      vec2 d = vec2(cos(a), sin(a)); vec2 r = p - o; float t = dot(r, d); if(t < 0.) continue;
      float perp = abs(r.x*d.y - r.y*d.x); float w = 0.003 + t*0.025;
      float b = smoothstep(w, w*0.15, perp)*exp(-t*0.35);
      vec3 c = mix(palc(s*2 + int(mod(fi, 2.))), vec3(1.), 0.25*uFlash);
      col += c*b*(0.6 + 0.6*uGlow + 0.6*uHit);
    }
    vec2 lo = p - o; col += mix(palc(s*2), vec3(1.), 0.5)*0.002/(dot(lo, lo) + 0.002)*smoothstep(0.25, 0., length(lo))*(0.5 + uHit);
  }
  return col;
}`);

scene('tunnel', { name: 'LED Tunnel', cat: 'DJ Lights', speed: 'fast', palette: 'club', mode: 'same', companion: 'tunnel', family: ['warp', 'eqbars'],
  params: [{ name: 'Rings', def: 0.5 }, { name: 'Dots', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float nr = 6. + floor(uParam.x*8.);
  vec2 half_ = vec2(uAspect*0.5, 0.5);
  for(int i=0;i<14;i++){ float fi = float(i); if(fi >= nr) break;
    float dpt = fract(fi/nr + uTravel*0.35);
    float sc = 0.04 + pow(dpt, 2.2)*1.05;
    vec2 q = p/sc;
    float d = abs(sdRBox(q, half_*0.96, 0.06))*sc;
    float a = atan(q.y, q.x);
    float dots = mix(1., smoothstep(0.32, 0.12, abs(fract(a*48./TAU) - 0.5)), uParam.y);
    float line = exp(-(d*d)/(0.0022*0.0022))*dots;
    vec3 c = pal(fi*0.11 + floor(uBeat)*0.25);
    col += c*line*smoothstep(0., 0.25, dpt)*(0.5 + 0.8*uGlow);
  }
  for(int k=0;k<4;k++){ vec4 e = uHitEv[k]; if(e.x > 0.8) continue;
    float sc = 0.05 + e.x*1.4; float d = abs(sdRBox(p/sc, half_*0.96, 0.06))*sc;
    col += vec3(1.)*exp(-(d*d)/(0.004*0.004))*exp(-e.x*3.)*e.y; }
  return col;
}`);

scene('c9swag', { name: 'C9 Swags', cat: 'Christmas Lights', speed: 'any', palette: 'c9', mode: 'span', companion: 'c9swag', family: ['twinkle', 'arches'], cells: true,
  params: [{ name: 'Rows', def: 0.6 }, { name: 'Chase', def: 0.6 }, { name: 'Twinkle', def: 0.3 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float nrows = 2. + floor(uParam.x*3.);
  float nsw = max(2., floor(uAspect*2.));
  float W = uAspect/nsw; float sag = 0.07;
  for(int r=0;r<5;r++){ float fr = float(r); if(fr >= nrows) break;
    float y0 = 0.42 - fr*(0.86/nrows);
    float xs = p.x + uAspect*0.5; float sw = floor(xs/W); float lx = xs - sw*W - W*0.5;
    float ycur = y0 - sag*(1. - pow(lx/(W*0.5), 2.));
    col += vec3(0.05, 0.12, 0.05)*exp(-pow((p.y - ycur)/0.0015, 2.))*0.5;
    float sp = 0.06; float bi = floor(xs/sp + 0.5); float bxv = bi*sp - uAspect*0.5;
    float blx = bi*sp - sw*W - W*0.5; blx = clamp(blx, -W*0.5, W*0.5);
    float by = y0 - sag*(1. - pow(blx/(W*0.5), 2.)) - 0.022;
    vec2 q = (p - vec2(bxv, by))*vec2(1.3, 0.85);
    float d = length(q + vec2(0., 0.004*sign(q.y)));
    int ci = int(mod(bi + fr + floor(uBeat*uParam.y*2.)*(uParam.y > 0.05 ? 1. : 0.), 4.));
    vec3 c = palc(ci);
    float tw = 1. - uParam.z*0.7*step(0.7, hash11(bi*7.1 + fr*3. + floor(uTime*4.)));
    float v = 0.2 + 0.8*cellAt(vec2(clamp(xs/uAspect, 0., 0.999), clamp(1. - (fr + 0.5)/nrows, 0., 0.999)));
    float b = v*tw*(0.8 + 0.5*uGlow + 0.6*uHit);
    col += c*smoothstep(0.022, 0.013, d)*2.2*b + mix(c, vec3(1.), 0.3)*0.0007/(d*d + 0.0007)*smoothstep(0.08, 0., d)*b;
    col += vec3(0.04, 0.08, 0.04)*smoothstep(0.006, 0.003, length(p - vec2(bxv, by + 0.02)));
  }
  return col;
}`);

scene('twinkle', { name: 'Twinkle Lights', cat: 'Christmas Lights', speed: 'any', palette: 'warm', mode: 'span', companion: 'twinkle', family: ['c9swag', 'netlights'],
  params: [{ name: 'Density', def: 0.6 }, { name: 'Multicolor', def: 0.0 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float sc = 22. + uParam.x*18.;
  vec2 g = p*sc; vec2 id = floor(g); vec2 f = fract(g) - 0.5; vec2 h = hash22(id);
  vec2 lp = (h - 0.5)*0.6; float d = length(f - lp)/sc;
  vec2 wp = (id + 0.5 + lp)/sc;
  float tw = 0.35 + 0.65*pow(0.5 + 0.5*sin(uTime*(1. + 3.*h.x) + h.y*40.), 3.);
  float rip = 0.;
  for(int k=0;k<4;k++){ vec4 e = uHitEv[k]; if(e.x > 2.) continue;
    vec2 c = vec2((hash11(e.z*7.)-0.5)*uAspect*0.8, (hash11(e.z*13.) - 0.5)*0.7);
    rip += exp(-pow((length(wp - c) - e.x*0.9)*14., 2.))*exp(-e.x*1.4)*e.y; }
  float sp = 0.; for(int k=0;k<3;k++){ vec4 e = uAccEv[k]; if(e.x > 0.4) continue; if(hash12(id + e.z*31.) < 0.1) sp += exp(-e.x*9.)*e.y; }
  vec3 c = mix(uPal[0]*0.6 + uPal[1]*0.4, pal(h.x), uParam.y);
  float b = (tw*(0.5 + 0.5*uGlow) + rip*2. + sp*2.)*(0.6 + 0.4*uEnergy);
  col += c*smoothstep(0.0055, 0.002, d)*b*1.6 + c*0.00003/(d*d + 0.00003)*b*0.5*smoothstep(0.02, 0., d);
  col += vec3(1.)*smoothstep(0.004, 0.001, d)*sp;
  return col;
}`);

scene('netlights', { name: 'Net Lights', cat: 'Christmas Lights', speed: 'any', palette: 'rainbow', mode: 'span', companion: 'netlights', family: ['twinkle', 'c9swag'],
  params: [{ name: 'Mesh size', def: 0.5 }, { name: 'Wave speed', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float sz = 0.045 + (1. - uParam.x)*0.04;
  vec2 q = rot(PI*0.25)*p/sz;
  vec2 id = floor(q + 0.5); vec2 f = q - id;
  float wire = min(abs(f.x), abs(f.y));
  col += vec3(0.05, 0.1, 0.05)*exp(-pow(wire*sz/0.0012, 2.))*0.6;
  vec2 np = rot(-PI*0.25)*id*sz;
  float d = length(f)*sz;
  float wave = 0.5 + 0.5*sin(np.x*3. - uTravel*(1. + uParam.y*3.) + np.y*1.5);
  float rip = 0.;
  for(int k=0;k<4;k++){ vec4 e = uHitEv[k]; if(e.x > 2.) continue; rip += exp(-pow((length(np) - e.x*1.1)*10., 2.))*exp(-e.x*1.2)*e.y; }
  vec3 c = pal(np.x*0.25 + np.y*0.2 - uTravel*0.05);
  float b = (0.25 + 0.75*wave)*(0.6 + 0.6*uGlow) + rip*2.2;
  col += c*(smoothstep(0.009, 0.004, d)*1.6 + 0.00006/(d*d + 0.00006)*0.4*smoothstep(0.03, 0., d))*b;
  return col;
}`);

scene('arches', { name: 'Light Arches', cat: 'Christmas Lights', speed: 'any', palette: 'classic', mode: 'span', companion: 'arches', family: ['c9swag', 'candycane'], cells: true,
  params: [{ name: 'Arches', def: 0.5 }, { name: 'Climb speed', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(2., floor(uAspect*(1.4 + uParam.x*1.2)));
  float W = uAspect/n;
  float xs = p.x + uAspect*0.5;
  for(int k=-1;k<=1;k++){
    float i = floor(xs/W) + float(k); if(i < 0. || i >= n) continue;
    vec2 c = vec2((i + 0.5)*W - uAspect*0.5, -0.47);
    float R = min(0.42, W*0.46); float H = 0.86;
    vec2 q = p - c; q.y *= R/H; float r = length(q); float th = atan(q.y, q.x);
    if(q.y < -0.01) continue;
    float nb = 17.; float bi = floor(clamp(th/PI, 0., 0.9999)*nb); float bth = (bi + 0.5)/nb*PI;
    vec2 bp = vec2(cos(bth)*R, sin(bth)*H); float d = length((p - c) - bp);
    float s = min(bth, PI - bth)/(PI*0.5);
    float speed = 1. + floor(uParam.y*2.);
    float fill = fract(uBeat*speed/2.); fill = 1. - pow(1. - fill, 2.);
    float lit = step(s, fill*1.02) + 0.18;
    float v = 0.15 + 0.85*cellAt(vec2((i + 0.5)/n, 0.5));
    vec3 cc = palc(int(mod(i, 4.)));
    float b = lit*v*(0.8 + 0.5*uGlow + 0.7*uHit);
    col += cc*(smoothstep(0.013, 0.007, d)*1.8 + 0.0002/(d*d + 0.0002)*smoothstep(0.05, 0., d)*0.6)*b;
    col += cc*0.05*exp(-pow((r - R)*H/R/0.003, 2.))*v;
  }
  return col;
}`);

scene('wreath', { name: 'Wreaths', cat: 'Christmas Lights', speed: 'any', palette: 'classic', mode: 'same', companion: 'wreath', family: ['tree', 'candycane'], cells: true,
  params: [{ name: 'Chase', def: 0.6 }, { name: 'Bow', def: 1 }] }, FIG_GLSL + `
vec3 wreath(vec2 p, vec2 c, float R, float wi){
  vec3 col = vec3(0.);
  vec2 q = p - c; float r = length(q); float a = atan(q.y, q.x);
  if(r > R*1.6) return col;
  float edge = 0.12*R*fbm3(vec2(a*6., wi*3.));
  float ring = smoothstep(0.004, 0., abs(r - R*0.92) - R*0.2 - edge);
  col += vec3(0.004, 0.03, 0.01)*ring*(0.5 + 0.5*fbm3(q*60.));
  float nb = 26.; float bi = floor(fract(a/TAU + 0.25)*nb); float ba = (bi + 0.5)/nb*TAU - PI*0.5;
  float br = R*(0.92 + 0.12*sin(bi*2.7));
  vec2 bp = vec2(cos(ba), sin(ba))*br; float d = length(q - bp);
  float ch = mod(bi + floor(uBeat*2.*uParam.x + 0.5), 3.) < 1. ? 1. : 0.35;
  float v = 0.2 + 0.8*cellAt(vec2(fract(a/TAU + 0.25), 0.5));
  vec3 bc = palc(int(mod(bi, 4.)));
  float b = ch*v*(0.8 + 0.5*uGlow + 0.7*uHit);
  col += bc*(smoothstep(0.012, 0.006, d)*1.7 + 0.00015/(d*d + 0.00015)*smoothstep(0.05, 0., d)*0.5)*b;
  if(uParam.y > 0.5){
    vec2 bq = q - vec2(0., -R*0.95);
    float bow = min(sdEll(vec2(abs(bq.x), bq.y), vec2(R*0.17, R*0.04), vec2(R*0.17, R*0.08), 0.25), length(bq) - R*0.05);
    bow = min(bow, sdSeg(vec2(abs(bq.x), bq.y), vec2(0.), vec2(R*0.14, -R*0.32)) - R*0.03);
    col += vec3(1., 0.06, 0.08)*(smoothstep(0.003, -0.003, bow)*0.5 + lineGlow(bow, 0.003)*0.9)*(0.7 + 0.5*uGlow);
  }
  return col;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  if(uAspect > 1.7){ float x = uAspect*0.31; col += wreath(p, vec2(-x, 0.02), 0.27, 1.) + wreath(p, vec2(0., 0.02), 0.32, 2.) + wreath(p, vec2(x, 0.02), 0.27, 3.); }
  else col += wreath(p, vec2(0., 0.02), 0.34, 2.);
  return col;
}`);

scene('candycane', { name: 'Candy Canes', cat: 'Christmas Lights', speed: 'any', palette: 'candy', mode: 'span', companion: 'candycane', family: ['arches', 'wreath'], cells: true,
  params: [{ name: 'Canes', def: 0.5 }, { name: 'Stripe speed', def: 0.5 }] }, FIG_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(2., floor(uAspect*(1.6 + uParam.x*1.6)));
  float W = uAspect/n; float xs = p.x + uAspect*0.5;
  float i = floor(xs/W);
  float bounce = abs(sin((uBeat + mod(i, 2.))*PI*0.5))*0.03*(0.5 + uFlow);
  vec2 q = p - vec2((i + 0.5)*W - uAspect*0.5 - W*0.12, bounce);
  float hr = min(0.085, W*0.22); float top = 0.18; float w = 0.022;
  float dShaft = sdSeg(q, vec2(0., -0.44), vec2(0., top));
  vec2 hq = q - vec2(hr, top);
  float dHook = q.y > top ? abs(length(hq) - hr) : 1e3;
  if(q.y > top && hq.x > hr*0.2 && hq.y < 0.){ dHook = 1e3; }
  float dEnd = length(q - vec2(hr*2., top));
  float d = min(dShaft, min(dHook, q.y > top - 0.001 && hq.x > 0. && hq.y < 0.02 ? 1e3 : 1e3)) ;
  d = min(dShaft, dHook); d = min(d, dEnd + 1e3*step(0., hq.y));
  float s = q.y < top ? q.y : top + atan(hq.y, -hq.x)*hr;
  float stripe = step(0.5, fract((s - q.x*0.9)*9. - uTravel*(0.6 + uParam.y*2.)));
  float v = 0.25 + 0.75*cellAt(vec2((i + 0.5)/n, 0.5));
  vec3 c = mix(uPal[0], uPal[1], stripe);
  float inside = smoothstep(w, w - 0.004, d);
  float rim = lineGlow(d - w, 0.003);
  col += c*inside*(0.55 + 0.4*uGlow + 0.6*uHit)*v + mix(c, vec3(1.), 0.3)*rim*0.6*v;
  return col;
}`);

scene('starburst', { name: 'Star Burst', cat: 'Stars', speed: 'fast', palette: 'bethlehem', mode: 'span', companion: 'starburst', family: ['starshower', 'fireworks'],
  params: [{ name: 'Stars per hit', def: 0.5 }, { name: 'Confetti', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float ns = 4. + floor(uParam.x*5.);
  for(int k=0;k<6;k++){ vec4 e = uHitEv[k]; if(e.x > 2.2) continue;
    vec2 c = vec2((hash11(e.z*11.) - 0.5)*uAspect*0.75, (hash11(e.z*5.3) - 0.5)*0.45);
    float age = e.x; float fade = exp(-age*1.5)*e.y;
    if(length(p - c) > 0.15 + age*0.8) continue;
    for(int i=0;i<9;i++){ float fi = float(i); if(fi >= ns) break;
      float a = fi/ns*TAU + e.z*6.;
      vec2 dir = vec2(cos(a), sin(a));
      float sp = 0.45 + 0.25*hash11(fi + e.z*9.);
      vec2 pos = c + dir*sp*(1. - exp(-age*3.))/3.*2. - vec2(0., 0.05*age*age);
      float r = 0.03 + 0.015*hash11(fi*3. + e.z);
      float ds = sdStar5(rot(age*(2. + fi) + a)*(p - pos), r, 0.42);
      vec3 sc = mix(pal(hash11(fi + e.z*3.)), vec3(1.), 0.35);
      col += sc*(smoothstep(0.003, -0.002, ds)*1.6 + 0.0004/(max(ds,0.)*max(ds,0.) + 0.0004)*0.25*smoothstep(0.05, 0., ds))*fade;
      vec2 tq = p - pos; float trail = sdSeg(p, pos, pos - dir*0.06*(1. - exp(-age*3.)));
      col += sc*exp(-pow(trail/0.003, 2.))*fade*0.5;
    }
    if(uParam.y > 0.05){
      for(int j=0;j<10;j++){ float fj = float(j); float a = hash11(fj*7. + e.z*13.)*TAU; float sp = 0.2 + 0.5*hash11(fj*3.1 + e.z);
        vec2 pos = c + vec2(cos(a), sin(a))*sp*(1. - exp(-age*3.))/3.*2. - vec2(0., 0.08*age*age);
        vec2 d = p - pos; float tw = step(0.4, hash11(floor(age*20.) + fj + e.z*5.));
        col += vec3(1., 0.95, 0.8)*0.000015/(dot(d, d) + 0.000015)*fade*tw*uParam.y*smoothstep(0.02, 0., length(d)); }
    }
  }
  col += uPal[0]*0.03*uGlow*exp(-length(p)*3.);
  return col;
}`);

scene('starshower', { name: 'Shooting Star Shower', cat: 'Stars', speed: 'any', palette: 'icy', mode: 'span', companion: 'starshower', family: ['starfield', 'starburst'],
  params: [{ name: 'Rate', def: 0.5 }, { name: 'Angle', def: 0.4 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float ang = -0.35 - uParam.y*0.6;
  mat2 R = rot(-ang);
  for(int l=0;l<3;l++){ float fl = float(l);
    float sc = 5. + fl*3.;
    vec2 q = R*p*sc; q.x -= uTravel*(1.2 + fl*0.5);
    vec2 id = floor(q); vec2 f = fract(q);
    float h = hash12(id + fl*7.);
    float dens = 0.12 + uParam.x*0.25 + uFlow*0.2;
    if(h < dens){
      float y0 = 0.2 + 0.6*hash12(id + 3.1); float x0 = hash12(id + 9.7)*0.4;
      float len = 0.5;
      float along = (f.x - x0)/len; float perp = abs(f.y - y0)/sc;
      if(along > 0. && along < 1.){
        float b = pow(along, 3.)*exp(-pow(perp/(0.0012 + 0.0016*along), 2.))*smoothstep(0.012, 0.004, perp);
        col += mix(uPal[1], vec3(1.), along)*b*(0.6 + 0.5*uGlow)*(1. - fl*0.25);
      }
      vec2 hd = vec2((f.x - x0 - len)/sc, (f.y - y0)/sc);
      col += vec3(1.)*0.000008/(dot(hd, hd) + 0.000008)*(0.5 + 0.5*uGlow)*(1. - fl*0.3)*smoothstep(0.012, 0., length(hd));
    }
  }
  for(int k=0;k<6;k++){ vec4 e = uAccEv[k]; if(e.x > 0.9) continue;
    vec2 st = vec2((hash11(e.z*17.) - 0.5)*uAspect, 0.5); vec2 dir = rot(ang)*vec2(1., 0.);
    vec2 head = st + dir*e.x*1.5; vec2 tail = head - dir*min(e.x*1.5, 0.35);
    float d = sdSeg(p, head, tail); float al = clamp(dot(p - tail, dir)/max(0.001, length(head - tail)), 0., 1.);
    col += mix(uPal[0], vec3(1.), al)*al*al*exp(-d*d/0.000004)*exp(-e.x*2.)*e.y*2.;
    col += vec3(1.)*0.00006/(dot(p - head, p - head) + 0.00006)*exp(-e.x*2.5)*e.y;
  }
  return col;
}`);

scene('constellation', { name: 'Constellations', cat: 'Stars', speed: 'slow', palette: 'icy', mode: 'span', companion: 'constellation', family: ['starfield', 'galaxy'],
  params: [{ name: 'Stars', def: 0.6 }, { name: 'Lines', def: 0.7 }] }, `
vec2 starPos(float i){ vec2 h = vec2(hash11(i*3.17), hash11(i*7.91)); vec2 b = vec2((h.x - 0.5)*uAspect*0.9, (h.y - 0.5)*0.82);
  return b + 0.02*vec2(sin(uTravel*0.2 + i), cos(uTravel*0.17 + i*1.3)); }
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = floor(uAspect*(5. + uParam.x*5.));
  float barf = fract(uBar*0.25);
  for(int i=0;i<40;i++){ float fi = float(i); if(fi >= n) break;
    vec2 a = starPos(fi); vec2 d = p - a;
    float br = 0.5 + 0.5*sin(uTime*(0.8 + hash11(fi)*2.) + fi);
    for(int k=0;k<3;k++){ vec4 e = uAccEv[k]; if(e.x > 0.8) continue; if(floor(hash11(e.z*29.)*n) == fi) br += 2.*exp(-e.x*4.)*e.y; }
    float dd = length(d);
    col += mix(vec3(0.85, 0.92, 1.), uPal[0], 0.3)*(smoothstep(0.006, 0.002, dd)*1.4 + 0.00012/(dd*dd + 0.00012)*0.35*smoothstep(0.06, 0., dd))*(0.5 + 0.4*br)*(0.7 + 0.5*uGlow);
    col += vec3(1.)*(exp(-abs(d.y)*700.)*exp(-abs(d.x)*45.) + exp(-abs(d.x)*700.)*exp(-abs(d.y)*45.))*br*0.25;
    if(uParam.y > 0.05){
      vec2 b = a; float bd = 1e3;
      for(int j=1;j<5;j++){ vec2 c2 = starPos(mod(fi + float(j)*3., n)); float l2 = length(c2 - a); if(l2 < bd && l2 > 0.01){ bd = l2; b = c2; } }
      if(bd > 0.6) continue;
      float prog = smoothstep(0., 0.3, barf - fract(fi*0.137)*0.4)*(1. - smoothstep(0.9, 1., barf));
      vec2 e2 = mix(a, b, prog); float dl = sdSeg(p, a, e2);
      col += mix(uPal[1], vec3(1.), 0.3)*exp(-pow(dl/0.0018, 2.))*0.7*uParam.y*(0.6 + 0.6*uGlow);
    }
  }
  return col;
}`);

scene('starwall', { name: 'Star Lights', cat: 'Stars', speed: 'any', palette: 'bethlehem', mode: 'same', companion: 'starwall', family: ['bulbs', 'starburst'], cells: true,
  params: [{ name: 'Star size', def: 0.5 }, { name: 'Twinkle', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  float rows = 4.; float s = 1./rows;
  vec2 g = (p + vec2(uAspect*0.5, 0.5))/s; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float cols = floor(uAspect*rows);
  if(id.x >= cols) return vec3(0.);
  float alt = mod(id.y, 2.); f.x += alt*0.0;
  float v = cellAt((id + 0.5)/vec2(cols, rows));
  float tw = 1. - uParam.y*0.5*(0.5 + 0.5*sin(uTime*3. + hash12(id)*20.));
  float r = 0.22 + uParam.x*0.14;
  float ds = sdStar5(rot(sin(uBeat*PI*0.25 + id.x)*0.2)*f, r, 0.45);
  vec3 c = mix(palc(int(mod(id.x + id.y, 4.))), vec3(1.), 0.2);
  float b = (0.12 + 0.88*v)*tw*(0.8 + 0.4*uGlow + 0.6*uHit);
  vec3 col = c*(smoothstep(0.02, -0.01, ds)*1.4 + 0.004/(max(ds, 0.)*max(ds, 0.) + 0.004)*0.2*smoothstep(0.3, 0., ds))*b;
  col += vec3(1.)*smoothstep(0.08, 0.0, length(f))*b*0.6;
  return col;
}`);

scene('moravian', { name: 'Moravian Star', cat: 'Stars', speed: 'slow', palette: 'gold', mode: 'same', companion: 'starfield', family: ['bethlehem', 'starburst'],
  params: [{ name: 'Points', def: 0.5 }, { name: 'Rays', def: 0.6 }] }, FIG_GLSL + `
float spikes(vec2 q, float N, float R, float w0, float rotA, out float side){
  float r = length(q); float a = atan(q.y, q.x) - rotA;
  float seg = TAU/N; float da = mod(a + seg*0.5, seg) - seg*0.5;
  side = sign(da);
  float halfw = w0*(1. - r/R); return abs(da)*r - max(halfw, 0.);
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  vec2 q = p - vec2(0., 0.02);
  float R = 0.4*(1. + 0.06*uHit + 0.04*uGlow);
  float N = 8. + floor(uParam.x*3.)*2.;
  float rotA = uTravel*0.05;
  float s1, s2;
  float d1 = spikes(q, N, R, 0.12, rotA, s1);
  float d2 = spikes(q, N, R*0.72, 0.1, rotA + PI/N, s2);
  float r = length(q);
  vec3 warm = mix(uPal[0], uPal[1], 0.4);
  float k = 0.65 + 0.5*uGlow + 0.5*uHit;
  if(d2 < 0.){ col = warm*(0.55 + 0.35*s2)*(1.2 - r/R)*1.3*k; }
  if(d1 < 0. && d2 >= 0.){ col = warm*(0.45 + 0.4*s1)*(1.25 - r/R)*1.2*k; }
  col += warm*lineGlow(min(abs(d1), abs(d2) + step(0., d2)*1.), 0.0025)*0.6*k;
  col += mix(warm, vec3(1.), 0.7)*0.004/(r*r + 0.004)*0.5*k*smoothstep(0.4, 0., r);
  float a = atan(q.y, q.x);
  float rays = pow(0.5 + 0.5*sin(a*N + rotA*N + 0.3), 18.)*exp(-(r - R*0.5)*3.)*step(R*0.8, r)*uParam.y;
  col += uPal[2]*rays*0.22*k;
  col += vec3(1.)*uFlash*0.05*exp(-r*3.);
  return col;
}`);

scene('angel', { name: 'Herald Angel', cat: 'Angels & Faith', speed: 'slow', palette: 'gold', mode: 'same', companion: 'halos', family: ['angelchoir', 'glory'],
  params: [{ name: 'Pair on wide door', def: 1 }, { name: 'Sparkle', def: 0.5 }] }, ANGEL_GLSL + `
vec3 drawAngel(vec2 q, float sc, float mirror){
  vec3 col = vec3(0.);
  q /= sc; q.x *= mirror;
  float flap = sin(uBeat*PI*0.5)*0.12*(0.3 + uFlow) + 0.05*uGlow;
  float h, bell; float d = angelSD(q, flap, 1., h, bell);
  vec3 gold = mix(uPal[0], uPal[1], 0.5);
  float k = 0.7 + 0.5*uGlow + 0.4*uHit;
  float sp = 0.75 + 0.25*sin(uTime*6. + hash12(floor(q*70.))*30.)*uParam.y;
  col += gold*lineGlow(d*sc, 0.0026)*1.2*k*sp;
  col += gold*0.035*smoothstep(0.004, -0.004, d)*k;
  col += mix(uPal[2], vec3(1.), 0.3)*lineGlow(h*sc, 0.003)*1.6*k;
  vec2 bq = (q - vec2(0.255, 0.175))*sc; float br = length(bq); float ba = atan(bq.y, bq.x);
  float burst = pow(0.5 + 0.5*cos(ba*9. + uTime*2.), 8.)*exp(-br*16.)*smoothstep(-0.2, 0.6, cos(ba))*uHit;
  col += mix(gold, vec3(1.), 0.6)*(burst*1.6 + 0.0004/(br*br + 0.0004)*uHit*0.6*smoothstep(0.15, 0., br));
  return col;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  if(uAspect > 1.7 && uParam.x > 0.5){
    col += drawAngel(p - vec2(-uAspect*0.24, 0.02), 0.92, 1.);
    col += drawAngel(p - vec2(uAspect*0.24, 0.02), 0.92, -1.);
  } else col += drawAngel(p - vec2(-0.03, 0.03), 1.05, 1.);
  return col;
}`);

scene('angelchoir', { name: 'Angel Choir', cat: 'Angels & Faith', speed: 'slow', palette: 'gold', mode: 'span', companion: 'angelchoir', family: ['angel', 'candles'], cells: true,
  params: [{ name: 'Angels', def: 0.5 }] }, ANGEL_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(2., floor(uAspect*(1.2 + uParam.x*1.2)));
  float W = uAspect/n; float xs = p.x + uAspect*0.5; float i = floor(xs/W);
  vec2 q = p - vec2((i + 0.5)*W - uAspect*0.5, -0.02);
  float sc = min(0.75, W*1.15);
  q /= sc;
  float flap = sin(uBeat*PI*0.5 + i)*0.1*(0.3 + uFlow);
  float h, bell; float d = angelSD(vec2(q.x*(mod(i, 2.) < 1. ? 1. : -1.), q.y), flap, 0., h, bell);
  float v = cellAt(vec2((i + 0.5)/n, 0.5));
  float k = (0.12 + 0.88*v)*(0.75 + 0.5*uGlow);
  vec3 gold = mix(uPal[0], uPal[1], 0.5);
  col += gold*lineGlow(d*sc, 0.0024)*1.1*k + gold*0.03*smoothstep(0.004, -0.004, d)*k;
  col += mix(uPal[2], vec3(1.), 0.3)*lineGlow(h*sc, 0.0028)*1.6*(0.3 + 0.7*k);
  return col;
}`);

scene('halos', { name: 'Halos & Feathers', cat: 'Angels & Faith', speed: 'slow', palette: 'gold', mode: 'span', companion: 'angel', family: ['angel', 'glory'],
  params: [{ name: 'Feathers', def: 0.5 }] }, FIG_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  vec3 gold = mix(uPal[0], uPal[1], 0.5);
  float ry = 0.05*sin(uTravel*0.1);
  for(int k=0;k<6;k++){ vec4 e = uHitEv[k]; if(e.x > 3.) continue;
    vec2 q = (p - vec2(0., 0.12 + ry))*vec2(1., 3.2);
    float r = 0.08 + e.x*0.55; float d = abs(length(q) - r)/3.2;
    col += gold*exp(-pow(d/0.004, 2.))*exp(-e.x*1.1)*e.y*1.4; }
  vec2 hq = (p - vec2(0., 0.12 + ry))*vec2(1., 3.2); float hd = abs(length(hq) - 0.08)/3.2;
  col += mix(gold, vec3(1.), 0.4)*lineGlow(hd, 0.003)*(0.8 + 0.6*uGlow);
  for(int l=0;l<2;l++){ float fl = float(l); float sc = 4. + fl*3.;
    vec2 g = p*sc; g.y += uTravel*(0.12 + fl*0.06)*sc*0.3; g.x += sin(g.y*0.7 + fl)*0.3;
    vec2 id = floor(g); vec2 f = fract(g) - 0.5; vec2 h = hash22(id + fl*5.);
    if(h.x > 0.1 + uParam.x*0.3) continue;
    float sway = sin(uTime*0.8 + h.y*9.)*0.6;
    vec2 fq = rot(sway + h.y*3.)*(f - (h - 0.5)*0.2)/sc;
    float L = 0.3/sc*0.55;
    float vane = sdEll(fq, vec2(0., 0.), vec2(L*0.28, L), 0.) ;
    vane = max(vane, -(fq.x*0.6 + fq.y*0.2) - L*0.3);
    float shaft = sdSeg(fq, vec2(0., -L*1.25), vec2(0., L*0.9));
    float glow = (lineGlow(vane, 0.0016)*0.7 + exp(-pow(shaft/0.0008, 2.))*0.5 + smoothstep(0.002, -0.002, vane)*0.1)*smoothstep(0.5, 0.42, max(abs(f.x), abs(f.y)) + 0.0);
    col += mix(gold, vec3(1.), 0.5)*glow*(0.6 + 0.5*uGlow)*(1. - fl*0.3);
  }
  float rays = pow(noise(vec2(atan(p.x, 0.9 - p.y)*14., uTravel*0.05)), 3.)*smoothstep(1.2, 0.2, length(p - vec2(0., 0.9)));
  col += gold*rays*0.12*(0.5 + uGlow);
  return col;
}`);

scene('nativity', { name: 'Nativity', cat: 'Angels & Faith', speed: 'slow', palette: 'gold', mode: 'same', companion: 'bethlehem', family: ['bethlehem', 'angel'],
  params: [{ name: 'Star', def: 1 }] }, FIG_GLSL + `
float figures(vec2 p){
  float d = 1e3;
  float g = -0.47;
  d = min(d, p.y - g);
  vec2 sq = p;
  float roof = abs(abs(sq.x)*0.48 + sq.y - 0.3) - 0.018; roof = max(roof, abs(sq.x) - 0.56);
  d = min(d, roof);
  d = min(d, sdBox(vec2(abs(p.x) - 0.44, p.y - (g + 0.32)*0.5 - 0.02), vec2(0.016, 0.39)));
  d = min(d, sdBox(p - vec2(0., 0.07), vec2(0.46, 0.012)));
  vec2 m = p - vec2(-0.2, 0.);
  d = min(d, sdTrap(m, g, -0.2, 0.1, 0.035));
  d = min(d, length(m - vec2(0.02, -0.15)) - 0.038);
  d = min(d, sdEll(m, vec2(0.0, -0.15), vec2(0.05, 0.06), 0.3));
  vec2 j = p - vec2(0.24, 0.);
  d = min(d, sdTrap(j, g, 0.0, 0.085, 0.035));
  d = min(d, length(j - vec2(0., 0.045)) - 0.037);
  d = min(d, sdSeg(j, vec2(0.09, g), vec2(0.09, 0.16)) - 0.008);
  d = min(d, abs(length(j - vec2(0.065, 0.16)) - 0.025) - 0.007 + step(j.y, 0.16)*1.);
  vec2 c = p - vec2(0.0, -0.36);
  d = min(d, sdTrap(c, -0.05, 0.03, 0.06, 0.1));
  d = min(d, sdSeg(c, vec2(-0.06, -0.11), vec2(0.05, -0.04)) - 0.009);
  d = min(d, sdSeg(c, vec2(0.06, -0.11), vec2(-0.05, -0.04)) - 0.009);
  return d;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  vec2 m = vec2(0., -0.31);
  float k = 0.6 + 0.6*uGlow;
  float r = length((p - m)*vec2(0.8, 1.));
  col += mix(uPal[2], uPal[0], 0.5)*(exp(-r*2.6)*0.75 + exp(-r*1.2)*0.04)*k;
  if(uParam.x > 0.5){
    vec2 sp = p - vec2(0., 0.4); float sd = sdStar5(sp, 0.035, 0.42);
    col += vec3(1., 0.95, 0.85)*(smoothstep(0.003, -0.002, sd)*1.5 + 0.002/(max(sd,0.)*max(sd,0.)*30. + 0.002)*0.3*smoothstep(0.3, 0., sd))*(0.8 + 0.6*uHit);
    col += vec3(1., 0.9, 0.7)*exp(-abs(sp.x)*240.)*smoothstep(0.02, -0.7, sp.y)*0.25*k;
  }
  float d = figures(p);
  col *= smoothstep(-0.001, 0.004, d);
  col += mix(uPal[0], vec3(1.), 0.4)*lineGlow(d, 0.0025)*0.25*k*smoothstep(1.1, 0.1, r);
  vec2 b = p - vec2(0., -0.315); float bd = sdEll(b, vec2(0.), vec2(0.04, 0.016), 0.);
  col += vec3(1., 0.96, 0.85)*(smoothstep(0.004, -0.004, bd)*1.6 + 0.001/(max(bd,0.)*max(bd,0.)*40. + 0.001)*0.35)*k;
  return col;
}`);

scene('snowman', { name: 'Snowman (Mr. Branch)', cat: 'Winter', speed: 'any', palette: 'icy', mode: 'same', companion: 'snowstorm', family: ['snowstorm', 'snowflake'],
  params: [{ name: 'Bounce', def: 0.6 }, { name: 'Snow', def: 0.5 }] }, FIG_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  for(int l=0;l<2;l++){ float fl = float(l); float sc = 14. - fl*5.;
    vec2 g = p*sc; g.y += uTravel*(0.25 + fl*0.1)*sc*0.3; vec2 id = floor(g); vec2 f = fract(g) - 0.5; vec2 h = hash22(id + fl*3.);
    if(h.x < uParam.y*0.6){ float d = length(f - (h - 0.5)*0.6)/sc; col += vec3(0.8, 0.9, 1.)*smoothstep(0.004 + fl*0.003, 0.001, d)*0.4; } }
  float sq = 1. - 0.07*exp(-uBeatPhase*7.)*uParam.x;
  vec2 q = p - vec2(0., -0.46); q.y /= sq; q.x *= 1. + (1. - sq)*0.6;
  float tilt = sin(uBeat*PI*0.5)*0.06*uParam.x; q = rot(tilt*smoothstep(0., 0.6, q.y))*q;
  float b1 = length(q - vec2(0., 0.16)) - 0.16;
  float b2 = length(q - vec2(0., 0.4)) - 0.115;
  float b3 = length(q - vec2(0., 0.585)) - 0.082;
  float body = min(b1, min(b2, b3));
  vec3 ice = mix(vec3(0.85, 0.93, 1.), uPal[0], 0.3);
  float k = 0.7 + 0.5*uGlow;
  col += ice*lineGlow(body, 0.0028)*1.2*k + ice*0.03*smoothstep(0.003, -0.003, body);
  float wave = sin(uBeat*PI*0.5)*0.35*(0.3 + uFlow);
  for(int s=0;s<2;s++){ float sd = s == 0 ? -1. : 1.;
    vec2 a0 = vec2(sd*0.1, 0.43); float ang = sd > 0. ? 0.45 + wave : PI - 0.45 + wave*0.6;
    vec2 a1 = a0 + vec2(cos(ang), sin(ang))*0.2;
    float br = sdSeg(q, a0, a1);
    vec2 t1 = mix(a0, a1, 0.6); br = min(br, sdSeg(q, t1, t1 + vec2(cos(ang + 0.7*sd), sin(ang + 0.7*sd))*0.06));
    br = min(br, sdSeg(q, a1, a1 + vec2(cos(ang - 0.5*sd), sin(ang - 0.5*sd))*0.05));
    col += vec3(1., 0.62, 0.3)*lineGlow(br, 0.0025)*1.1*k;
  }
  vec2 hq = q - vec2(0., 0.66); hq = rot(-0.12)*hq;
  float hat = min(sdBox(hq, vec2(0.085, 0.01)), sdBox(hq - vec2(0., 0.07), vec2(0.055, 0.065)));
  col += vec3(0.9, 0.95, 1.)*lineGlow(hat, 0.0025)*1.1*k;
  col += uPal[1]*lineGlow(sdBox(hq - vec2(0., 0.02), vec2(0.056, 0.008)), 0.002)*0.8*k;
  float scarf = min(sdBox(q - vec2(0., 0.505), vec2(0.085, 0.016)), sdBox(rot(0.15)*(q - vec2(0.05, 0.44)), vec2(0.018, 0.06)));
  col += vec3(1., 0.12, 0.12)*(lineGlow(scarf, 0.0022)*1.1 + smoothstep(0.002, -0.002, scarf)*0.25)*k;
  float sp = 1. + 2.5*uAcc;
  vec2 e1 = q - vec2(-0.03, 0.605), e2 = q - vec2(0.03, 0.605);
  col += vec3(1.)*(smoothstep(0.012, 0.006, length(e1)) + smoothstep(0.012, 0.006, length(e2)))*sp*0.8;
  float nose = sdSeg(q, vec2(0., 0.58), vec2(0.08, 0.57)) - 0.008*(1. - clamp((q.x)/0.08, 0., 1.));
  col += vec3(1., 0.5, 0.1)*(smoothstep(0.003, -0.002, nose)*1.2 + lineGlow(nose, 0.002)*0.5)*k;
  for(int i=0;i<3;i++){ vec2 bq = q - vec2(0., 0.47 - float(i)*0.06); col += vec3(1.)*smoothstep(0.011, 0.006, length(bq))*(0.6 + uHit)*0.8; }
  return col;
}`);

const SCENE_ORDER2 = ['lasers', 'movingheads', 'scanners', 'strobe', 'discoball', 'eqbars', 'tunnel', 'c9swag', 'twinkle', 'netlights', 'arches', 'wreath', 'candycane',
  'starburst', 'starshower', 'constellation', 'starwall', 'moravian', 'angel', 'angelchoir', 'halos', 'nativity', 'snowman'];
