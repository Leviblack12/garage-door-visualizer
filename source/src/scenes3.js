/* Scene library, part 3 (Nov 2026): sparkle angels, candy, more Christmas lights, music, winter, patterns.
   Same contract as scenes.js / scenes2.js. No characters: shapes, lights and objects only. */
Object.assign(PALETTES, {
  angelglow: { name: 'Angel Glow', c: ['#ffffff', '#ffd08a', '#6fa4ff', '#fff3dc'] },
  peppermint: { name: 'Peppermint', c: ['#ff1430', '#ffffff', '#ff7a8a', '#22c45e'] },
  sweets: { name: 'Sweet Shop', c: ['#ff4fa3', '#ffd23f', '#38d8ff', '#7cff6b'] },
  gift: { name: 'Gift Wrap', c: ['#d8102a', '#0f9a40', '#ffd36b', '#ffffff'] },
  ember: { name: 'Fireside', c: ['#ff4a0a', '#ffae2b', '#ffe7a0', '#ff2a0a'] },
});

/* ------------------------------------------------------------------ Sparkle Angels */
const SPARKLE_ANGEL_GLSL = FIG_GLSL + `
float angelBody(vec2 q, float raise){
  vec2 m = vec2(abs(q.x), q.y);
  float d = sdTrap(q, -0.6, 0.12, 0.2, 0.07);
  d = min(d, length(q - vec2(0., 0.25)) - 0.085);
  vec2 sh = vec2(0.05, 0.11);
  for(int k=0;k<5;k++){ float fk = float(k);
    float a = 0.7 + raise*(1. - fk*0.15) - fk*0.25;
    float L = 1.05 - fk*0.13;
    vec2 dir = vec2(cos(a), sin(a));
    d = min(d, sdEll(m, sh + dir*L*0.5, vec2(L*0.5, 0.13 - fk*0.014), -a));
  }
  return d;
}
vec3 angSpark(vec2 q, float cs, float sd, float raise, float boost, float blur, float warm){
  vec2 g = q/cs; vec2 id = floor(g); vec2 h = hash22(id + sd);
  vec2 pc = id + 0.5 + (h - 0.5)*0.6;
  float d = angelBody(pc*cs, raise);
  float dens = smoothstep(0.12, -0.14, d);
  float h3 = hash12(id*1.371 + sd*7.3);
  if(h3 > dens*(0.6 + 0.4*clamp(boost, 0., 1.))) return vec3(0.);
  vec2 o = g - pc; float r2 = dot(o, o);
  float s2 = 0.018 + blur*0.09;
  float tw = 0.5 + 0.5*sin(uTime*(2. + h.x*7.)*max(0.3, uSpeed) + h.y*50.);
  float a = exp(-r2/s2)*(0.25 + 0.75*tw)/(1. + blur*2.2);
  float k = hash11(h3*91.7 + sd);
  vec3 c = k < 0.62 - warm*0.25 ? uPal[0] : (k < 0.93 ? uPal[1] : uPal[2]);
  return c*a*(0.9 + boost);
}
vec3 angGlints(vec2 q, float cs, float sd, float raise, float boost){
  vec3 col = vec3(0.); vec2 g = q/cs - 0.5; vec2 b = floor(g);
  for(int j=0;j<4;j++){ vec2 id = b + vec2(float(j & 1), float(j >> 1));
    vec2 h = hash22(id + sd*1.7); vec2 pc = id + 0.5 + (h - 0.5)*0.5;
    if(hash12(id + sd*3.3) > 0.16 + 0.5*clamp(boost, 0., 1.)) continue;
    float d = angelBody(pc*cs, raise); float edge = smoothstep(0.16, 0.0, abs(d + 0.02));
    if(edge < 0.05) continue;
    vec2 o = rot(h.x*PI)*((g + 0.5 - pc)*cs);
    float L = 0.03 + 0.045*h.y;
    float ray = exp(-abs(o.y)/0.003)*exp(-abs(o.x)/L) + 0.7*exp(-abs(o.x)/0.003)*exp(-abs(o.y)/(L*0.7));
    float tw = 0.35 + 0.65*abs(sin(uTime*2.5*max(0.3, uSpeed) + h.y*30.));
    col += mix(uPal[2], vec3(1.), 0.25)*ray*tw*edge*(0.5 + boost);
  }
  return col;
}`;

scene('sparkleangels', { name: 'Sparkle Angels', cat: 'Angels & Faith', speed: 'any', palette: 'angelglow', mode: 'same', accentParams: { 3: 0 },
  family: ['halos', 'starfield', 'bethlehem'],
  params: [{ name: 'How many', def: 0.55 }, { name: 'Movement', def: 0.35 }, { name: 'Dreamy blur', def: 0.35 }, { name: 'Night sky', def: 0.6 }] }, SPARKLE_ANGEL_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  // sky: deep blue at the top, soft teal glow in the middle, dark at the bottom
  float sk = uParam.w;
  vec3 col = mix(vec3(0.003, 0.006, 0.025), vec3(0.012, 0.04, 0.15), smoothstep(-0.55, 0.5, p.y))*sk;
  col += vec3(0.03, 0.1, 0.16)*exp(-pow(length((p - vec2(0., 0.02))*vec2(0.7, 1.6)), 2.)*2.)*sk;
  col *= 1. - 0.6*smoothstep(-0.1, -0.5, p.y);
  { vec2 g = p*90.; vec2 id = floor(g); vec2 h = hash22(id + 4.1); float d = length(fract(g) - 0.5 - (h - 0.5)*0.6);
    col += vec3(0.8, 0.85, 1.)*step(0.93, h.x)*smoothstep(0.12, 0.02, d)*(0.25 + 0.3*sin(uTime*2. + h.y*40.))*sk; }
  float N = floor(mix(1., 22., uParam.x) + 0.5);
  float mv = uParam.y;
  for(int i=0;i<22;i++){ float fi = float(i); if(fi >= N) break;
    vec2 h = hash22(vec2(fi*7.13 + 1.3, 3.7));
    float z = N < 1.5 ? 1. : hash11(fi*3.31 + 1.7);
    float s = N < 1.5 ? 0.27 : (N < 3.5 ? 0.17 : mix(0.05, 0.12, z)*mix(1.25, 0.8, uParam.x));
    vec2 pos = N < 1.5 ? vec2(0., 0.04) : vec2(((fi + 0.15 + 0.7*h.x)/N - 0.5)*uAspect*0.94, N < 3.5 ? 0.05 : mix(-0.16, 0.3, h.y));
    // movement: slow drift + sway each bar + a hop on the beat; 0 = they only sparkle
    pos.x += mv*0.07*sin(uTravel*0.3 + fi*2.1);
    pos.y += mv*(0.035*sin(uTravel*0.45 + fi*1.7) + 0.022*pow(1. - abs(sin((uBeat + h.x)*PI*0.5)), 3.));
    if(length(p - pos) > s*1.3) continue;
    float sway = mv*0.13*sin(uBeat*PI*0.25 + fi*1.3);
    float flare = 0.;
    for(int k=0;k<4;k++){ vec4 e = uHitEv[k]; if(hash11(fi*1.7 + e.z*13.1) < 0.5) flare = max(flare, evEnv(e, 0.28)); }
    float boost = 0.3*uHit + flare + 0.35*uGlow;
    float raise = mv*0.18*sin(uBeat*PI + fi) + 0.32*uAcc - 0.05;
    vec2 q = rot(sway)*(p - pos)/s;
    float blur = N < 1.5 ? uParam.z*0.25 : uParam.z*(1. - z);
    float d0 = angelBody(q, raise);
    float cloud = 0.5 + 0.5*fbm3(q*3.2 + vec2(fi*3., -uTime*0.25*uSpeed));
    float core = smoothstep(0.02 + blur*0.1, -0.32, d0);
    float rim = smoothstep(1.3, 1.05, length(q));
    col += mix(uPal[3], vec3(1.), core)*core*cloud*0.85*(1. + 0.4*boost)/(1. + blur);
    col += uPal[2]*smoothstep(0.3 + blur*0.2, -0.05, d0)*0.05*rim;
    if(d0 > 0.25 + blur*0.2) continue;
    col += angSpark(q, 0.0055/s*(1. + blur*0.6), fi*11.3, raise, boost, blur, 0.);
    col += angSpark(q, 0.011/s*(1. + blur*0.6), fi*5.9 + 40., raise, boost*0.8, blur, 0.7)*0.8;
    if(blur < 0.6) col += angGlints(q, 0.032/s, fi*2.3, raise, boost)*(1. - blur);
  }
  // a few bright guide stars that flare on the beat
  for(int k=0;k<3;k++){ float fk = float(k); vec2 sp = vec2((hash11(fk*5.1 + 0.3) - 0.5)*uAspect*0.85, 0.05 + 0.35*hash11(fk*2.7 + 9.));
    vec2 o = p - sp; float tw = 0.4 + 0.6*abs(sin(uBeat*PI*0.25 + fk)) + uHit*0.6;
    col += vec3(1.)*(0.00002/(dot(o, o) + 0.00002) + exp(-abs(o.y)/0.0025)*exp(-abs(o.x)/0.03) + exp(-abs(o.x)/0.0025)*exp(-abs(o.y)/0.03))*0.5*tw*sk;
  }
  return col;
}`);


/* ------------------------------------------------------------------ Candy */
const CANDY_GLSL = FIG_GLSL + `
// q in units of the candy radius
vec4 mintCol(vec2 q, float ang, vec3 red, vec3 white){
  float r = length(q); if(r > 1.1) return vec4(0.);
  float a = atan(q.y, q.x) + ang;
  float w = sin(8.*a + 5.5*r);
  float thr = mix(0.85, 0.2, r);
  float wedge = smoothstep(thr - 0.07, thr + 0.07, w)*smoothstep(0.03, 0.14, r);
  float body = smoothstep(1., 0.95, r);
  vec3 c = mix(white*0.92, red, wedge);
  c *= 0.72 + 0.28*smoothstep(1., 0.55, r);
  vec2 hq = q - vec2(-0.35, 0.42); c += vec3(1.)*exp(-dot(hq, hq)*10.)*0.22;
  float rim = smoothstep(0.07, 0., abs(r - 1.03))*0.22;
  return vec4(c*body + white*rim, max(body, rim));
}
vec4 candyShape(vec2 q, float type, vec3 c, vec3 white){
  if(type < 1.){ // wrapped candy
    float body = smoothstep(1.02, 0.96, length(q/vec2(0.55, 0.38)));
    float xs = abs(q.x); float wrap = step(0.47, xs)*step(xs, 0.95)*step(abs(q.y), (xs - 0.47)*0.85 + 0.04);
    float st = smoothstep(-0.2, 0.2, sin((q.x + q.y)*16.));
    vec3 bc = mix(c, white, st*0.85)*(0.75 + 0.25*smoothstep(0.38, -0.2, q.y));
    vec3 wc = mix(c, white, 0.45)*(0.6 + 0.4*sin(q.y*40.)*0.5 + 0.2);
    return vec4(bc*body + wc*wrap*(1. - body), max(body, wrap));
  }
  if(type < 2.){ // lollipop
    vec2 cq = q - vec2(0., 0.22); float r = length(cq);
    float disk = smoothstep(0.56, 0.52, r);
    float sw = smoothstep(-0.25, 0.25, sin(atan(cq.y, cq.x) + r*26.));
    float stick = step(abs(q.x), 0.045)*step(-0.98, q.y)*step(q.y, -0.25);
    return vec4(mix(c, white, sw*0.9)*disk + white*0.7*stick*(1. - disk), max(disk, stick));
  }
  if(type < 3.){ // gumball
    float r = length(q); float b = smoothstep(0.5, 0.46, r);
    vec2 hq = q - vec2(-0.16, 0.18);
    return vec4((c*(0.55 + 0.45*smoothstep(0.5, 0., r)) + vec3(1.)*exp(-dot(hq, hq)*90.)*0.6)*b, b);
  }
  return mintCol(q/0.6, 0., c, white);
}`;

scene('peppermint', { name: 'Peppermint Spin', cat: 'Candy', speed: 'any', palette: 'peppermint', mode: 'same', cells: true, family: ['candytunnel', 'stripes'],
  params: [{ name: 'How many', def: 0.3 }, { name: 'Spin speed', def: 0.4 }, { name: 'Kick on hits', def: 0.7 }] }, CANDY_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = uPal[0]*0.035*(1. - 0.8*length(p/vec2(uAspect, 1.)));
  float rows = floor(mix(1., 4.99, uParam.x)); float cs = 1./rows;
  float ry = clamp(floor((p.y + 0.5)/cs), 0., rows - 1.);
  float off = rows > 1.5 ? mod(ry, 2.)*0.5 : 0.;
  float ix = floor(p.x/cs + off + 0.5);
  vec2 c = vec2((ix - off)*cs, (ry + 0.5)*cs - 0.5);
  if(rows < 1.5 && uParam.x < 0.12) c.x = 0.;
  float pop = 1. + 0.14*uParam.z*evEnv(uHitEv[0], 0.18);
  float R = (rows < 1.5 ? 0.45 : 0.45*cs)*pop;
  float dir = mod(ix + ry, 2.) < 1. ? 1. : -1.;
  float kick = (max(uHitEv[0].w, 0.) + smoothstep(0., 0.22, min(uHitEv[0].x, 1.)))*0.785*uParam.z;
  float ang = dir*(uTravel*(0.3 + 2.2*uParam.y) + kick);
  float lit = mix(0.4, 1., cellAt(vec2(c.x/uAspect + 0.5, c.y + 0.5)))*(0.8 + 0.35*uGlow);
  vec4 m = mintCol((p - c)/R, ang, uPal[0], uPal[1]);
  col = mix(col, m.rgb*lit, m.a);
  float rr = length(p - c)/R;
  col += uPal[0]*0.12*exp(-max(rr - 1., 0.)*9.)*step(1., rr)*lit;
  return col;
}`);

scene('candytunnel', { name: 'Peppermint Tunnel', cat: 'Candy', speed: 'fast', palette: 'peppermint', mode: 'same', family: ['peppermint', 'warp'],
  params: [{ name: 'Candies per ring', def: 0.4 }, { name: 'Zoom on hits', def: 0.6 }] }, CANDY_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float r = length(p); float a = atan(p.y, p.x);
  float n = floor(10. + uParam.x*8.); float tw = TAU/n;
  float kick = (max(uHitEv[0].w, 0.) + smoothstep(0., 0.3, min(uHitEv[0].x, 1.)))*0.35*uParam.y;
  float lr = log(max(r, 1e-3)) - uTravel*0.22 - kick;
  vec2 g = vec2(lr/tw, a/tw);
  float ring = floor(g.x); g.y += mod(ring, 2.)*0.5;
  vec2 id = vec2(ring, floor(g.y)); vec2 f = fract(g) - 0.5;
  vec2 h = hash22(id + 3.1);
  vec4 m = mintCol(f/0.44, uTime*(h.x - 0.5)*2.*uSpeed + h.y*6., uPal[0], uPal[1]);
  float fade = smoothstep(0.03, 0.16, r);
  col += m.rgb*fade*(0.8 + 0.35*uGlow);
  col += mix(uPal[0], vec3(1., 0.85, 0.6), 0.25)*exp(-r*7.)*(0.6 + 1.2*uHit);
  vec2 sg = p*28.; vec2 sid = floor(sg); vec2 sh = hash22(sid + 7.);
  col += vec3(1., 0.85, 0.5)*step(0.96, sh.x)*smoothstep(0.25, 0., length(fract(sg) - 0.5))*smoothstep(0.35, 0.05, r)*(0.4 + uHit);
  return col;
}`);

scene('candyrain', { name: 'Candy Rain', cat: 'Candy', speed: 'any', palette: 'sweets', mode: 'same', family: ['peppermint', 'snowstorm'],
  params: [{ name: 'Amount', def: 0.5 }, { name: 'Fall speed', def: 0.5 }] }, CANDY_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  for(int l=0;l<3;l++){ float fl = float(l);
    float cs = mix(0.085, 0.17, fl/2.);
    vec2 q = p; q.y += uTravel*(0.16 + 0.1*fl)*(0.4 + 1.2*uParam.y) + fl*0.37; q.x += fl*1.31 + 0.03*sin(uTime*0.7 + q.y*3.);
    vec2 g = q/cs; vec2 id = floor(g); vec2 f = fract(g) - 0.5; vec2 h = hash22(id + fl*17.);
    if(h.x > 0.25 + 0.6*uParam.x) continue;
    vec2 lq = (f - (h - 0.5)*0.25)/0.42;
    lq = rot(uTime*(h.y - 0.5)*3.*uSpeed + h.x*6.28)*lq;
    float type = floor(hash12(id*1.7 + fl)*4.);
    vec3 cc = pal(hash12(id*2.3 + fl));
    vec4 o = candyShape(lq, type, cc, vec3(1.));
    float dep = 0.55 + 0.25*fl;
    col = mix(col, o.rgb*dep*(0.85 + 0.4*uHit + 0.2*uGlow), o.a);
  }
  return col;
}`);

scene('stripes', { name: 'Candy Stripes', cat: 'Candy', speed: 'any', palette: 'candy', mode: 'same', cells: true, family: ['peppermint', 'giftwrap'],
  params: [{ name: 'Angle', def: 0.5 }, { name: 'Stripe width', def: 0.45 }, { name: 'Barber poles', def: 0.6 }, { name: 'Jump on hits', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  float cols = max(1., uGrid.x); float px = (p.x/uAspect + 0.5)*cols; float xf = fract(px) - 0.5;
  float poleW = uAspect/cols;
  float th = asin(clamp(xf*2., -1., 1.));
  float u = mix(p.x, floor(px)*poleW + th*poleW*0.5, uParam.z);
  float ang = mix(0., PI*0.5, uParam.x);
  float w = mix(0.035, 0.16, uParam.y);
  float kick = (max(uHitEv[0].w, 0.) + smoothstep(0., 0.2, min(uHitEv[0].x, 1.)))*0.5*uParam.w;
  float sc = (u*cos(ang) + p.y*sin(ang))/w - uTravel*0.9 - kick*2.;
  float aa = 0.06*(1. + uParam.z);
  float st = smoothstep(-aa, aa, sin(sc*PI));
  float pin = smoothstep(0.08, 0., abs(fract(sc*0.5 + 0.25) - 0.5))*0.;
  vec3 c = mix(uPal[1], uPal[0], st) + uPal[3]*pin;
  float shade = mix(1., (0.3 + 0.7*cos(th))*(1. + 0.5*exp(-pow((xf + 0.22)*7., 2.))), uParam.z);
  float gap = mix(1., smoothstep(0.5, 0.46, abs(xf)), uParam.z);
  float lit = mix(0.45, 1., cellAt(uv))*(0.7 + 0.35*uGlow + 0.25*uHit);
  return c*shade*gap*lit*0.9;
}`);

scene('lollipop', { name: 'Lollipop Swirls', cat: 'Candy', speed: 'any', palette: 'sweets', mode: 'same', family: ['candycarousel', 'kaleido'],
  params: [{ name: 'How many', def: 0.4 }, { name: 'Twist', def: 0.5 }, { name: 'Rings on hits', def: 0.7 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float cnt = max(1., floor(mix(1., 3.99, uParam.x)*min(1., uAspect/1.6) + 0.5));
  float spc = uAspect/cnt; float ix = floor((p.x + uAspect*0.5)/spc);
  vec2 c = vec2((ix + 0.5)*spc - uAspect*0.5, cnt > 1. ? 0.1 : 0.);
  float R = min(spc*0.44, cnt > 1. ? 0.34 : 0.44);
  vec2 q = p - c; float r = length(q)/R;
  float dir = mod(ix, 2.) < 1. ? 1. : -1.;
  if(cnt > 1. && abs(q.x) < 0.018 && q.y < 0.) col += vec3(0.75)*smoothstep(0.018, 0.01, abs(q.x))*0.5;
  if(r < 1.04){
    float a = atan(q.y, q.x) + dir*uTravel*1.3;
    float s = a/TAU*4. + r*mix(1.5, 5., uParam.y);
    float band = floor(mod(s, 4.)); float fs = fract(s);
    vec3 bc = band < 1. ? uPal[0] : band < 2. ? uPal[1] : band < 3. ? uPal[2] : uPal[3];
    bc = mix(bc, vec3(1.), smoothstep(0.1, 0.0, min(fs, 1. - fs))*0.8);
    float body = smoothstep(1.02, 0.97, r);
    vec2 hq = q/R - vec2(-0.35, 0.4);
    col = bc*body*(0.6 + 0.4*smoothstep(1., 0.3, r))*(0.8 + 0.35*uGlow) + vec3(1.)*exp(-dot(hq, hq)*12.)*0.25*body;
    col += vec3(1.)*smoothstep(0.05, 0., abs(r - 1.01))*0.35;
  }
  for(int k=0;k<3;k++){ vec4 e = uHitEv[k]; float rr = e.x*1.6*uParam.z; if(e.x > 2.) continue;
    col += mix(uPal[k], vec3(1.), 0.5)*exp(-pow((r - 1. - rr*3.)*6., 2.))*exp(-e.x*2.5)*e.y*uParam.z*0.8; }
  return col;
}`);

scene('candycarousel', { name: 'Candy Carousel', cat: 'Candy', speed: 'any', palette: 'peppermint', mode: 'same', family: ['lollipop', 'peppermint'],
  params: [{ name: 'Candies', def: 0.5 }, { name: 'Spin', def: 0.5 }] }, CANDY_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float cnt = max(1., floor(uAspect*0.9 + 0.5)); float spc = uAspect/cnt;
  float ix = floor((p.x + uAspect*0.5)/spc); vec2 c0 = vec2((ix + 0.5)*spc - uAspect*0.5, 0.);
  vec2 q = p - c0;
  float pulse = 1. + 0.07*evEnv(uHitEv[0], 0.22);
  float sz = min(spc*0.5, 0.46);
  for(int k=0;k<2;k++){ float fk = float(k);
    float n = fk < 0.5 ? floor(8. + uParam.x*6.) : floor(5. + uParam.x*3.);
    float R = (fk < 0.5 ? 0.74 : 0.38)*sz*pulse;
    float rotv = (fk < 0.5 ? 1. : -1.)*(uTravel*(0.25 + 0.9*uParam.y) + mod(ix, 2.)*1.3);
    float a = atan(q.y, q.x) - rotv; float i = floor(a/(TAU/n) + 0.5);
    float ca = i*TAU/n + rotv; vec2 cp = R*vec2(cos(ca), sin(ca));
    float rr = R*sin(PI/n)*0.86;
    vec2 lq = (q - cp)/rr;
    vec4 m = mod(i, 2.) < 1. ? mintCol(lq, uTime*1.5*uSpeed*(fk < 0.5 ? 1. : -1.), uPal[0], uPal[1]) : candyShape(lq*0.62, 2., mix(uPal[3], uPal[0], fk), vec3(1.));
    col = mix(col, m.rgb*(0.8 + 0.3*uGlow + 0.3*uHit), m.a);
  }
  float sd = sdStar5(rot(uTravel*0.4)*q, 0.1*sz*pulse/0.46, 0.45);
  col += vec3(1., 0.82, 0.35)*(smoothstep(0.004, -0.004, sd) + 0.003/(sd*sd + 0.003)*0.08*smoothstep(0.2, 0., sd))*(0.8 + uHit);
  return col;
}`);

/* ------------------------------------------------------------------ Christmas lights & decorations */
scene('lightframe', { name: 'Light String Frame', cat: 'Christmas Lights', speed: 'any', palette: 'c9', mode: 'same', cells: true, family: ['c9swag', 'twinkle'],
  params: [{ name: 'Bulbs', def: 0.45 }, { name: 'Twinkle on hits', def: 0.6 }, { name: 'Inset', def: 0.35 }] }, `
vec2 rectPt(float s, vec2 hb, out vec2 n){
  float P = 4.*(hb.x + hb.y); s = mod(s, P);
  if(s < 2.*hb.x){ n = vec2(0., 1.); return vec2(-hb.x + s, -hb.y); } s -= 2.*hb.x;
  if(s < 2.*hb.y){ n = vec2(-1., 0.); return vec2(hb.x, -hb.y + s); } s -= 2.*hb.y;
  if(s < 2.*hb.x){ n = vec2(0., -1.); return vec2(hb.x - s, hb.y); } s -= 2.*hb.x;
  n = vec2(1., 0.); return vec2(-hb.x, hb.y - s);
}
float rectS(vec2 p, vec2 hb){
  vec2 q = clamp(p, -hb, hb);
  float dl = q.x + hb.x, dr = hb.x - q.x, db = q.y + hb.y, dt = hb.y - q.y; float m = min(min(dl, dr), min(db, dt));
  if(m == db) return q.x + hb.x; if(m == dr) return 2.*hb.x + q.y + hb.y; if(m == dt) return 2.*hb.x + 2.*hb.y + hb.x - q.x;
  return 4.*hb.x + 2.*hb.y + hb.y - q.y;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float ins = mix(0.04, 0.12, uParam.z);
  vec2 hb = vec2(uAspect*0.5 - ins, 0.5 - ins);
  float P = 4.*(hb.x + hb.y);
  float N = floor(P/mix(0.12, 0.05, uParam.x)); float ds = P/N;
  float s = rectS(p, hb); vec2 n0; vec2 b0 = rectPt(s, hb, n0);
  float wd = abs(dot(p - b0, n0) - 0.013*sin(s*PI/ds));
  col += vec3(0.08, 0.14, 0.08)*smoothstep(0.004, 0.0015, wd)*step(length(p - b0), 0.05);
  float i0 = floor(s/ds);
  for(int k=-1;k<=1;k++){ float i = i0 + float(k);
    float si = (i + 0.5)*ds; vec2 nn; vec2 bp = rectPt(si, hb, nn);
    float side = mod(i, 2.) < 1. ? 1. : -1.;
    vec2 dir = nn*side; vec2 tang = vec2(-dir.y, dir.x);
    vec2 c = bp + nn*0.013*sin(si*PI/ds) + dir*0.024;
    vec2 q = p - c; vec2 lq = vec2(dot(q, tang), dot(q, dir));
    float d = length(lq/vec2(0.0115, 0.02)) - 1. + 0.35*smoothstep(0.0, 0.02, lq.y);
    vec2 buv = vec2(c.x/uAspect + 0.5, c.y + 0.5);
    float lit = mix(0.18, 1., cellAt(buv));
    for(int j=0;j<4;j++){ vec4 e = uHitEv[j]; if(hash11(i*0.37 + e.z*11.7) < 0.3*uParam.y) lit = max(lit, evEnv(e, 0.3)*1.3); }
    lit *= 0.75 + 0.4*uGlow;
    vec3 bc = palc(int(mod(i, 4.)));
    col += bc*(smoothstep(0.25, -0.35, d)*1.5 + 0.0012/(dot(q, q) + 0.0012)*0.2*smoothstep(0.09, 0., length(q)))*lit;
    vec2 sq = p - (bp + nn*0.013*sin(si*PI/ds) + dir*0.008);
    col += vec3(0.06, 0.1, 0.06)*smoothstep(0.006, 0.003, length(sq*vec2(1., 1.)));
  }
  return col;
}`);

scene('spiraltree', { name: 'Spiral Light Tree', cat: 'Christmas', speed: 'any', palette: 'warm', mode: 'same', family: ['tree', 'dottree'],
  params: [{ name: 'Turns', def: 0.5 }, { name: 'Redraw every 4 bars', def: 0.5 }, { name: 'Sparkle', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(1., floor(uAspect*1.25 + 0.5)); float sp = uAspect/n;
  float ix = floor((p.x + uAspect*0.5)/sp); float cx = (ix + 0.5)*sp - uAspect*0.5;
  float big = (n > 2. && abs(ix - (n - 1.)*0.5) < 0.6) ? 1. : (n > 2. ? 0.8 : 1.);
  float H = 0.8*big; float yb = -0.43; float Rb = min(sp*0.42, 0.3)*big;
  vec2 q = vec2(p.x - cx, p.y - yb); float y = q.y/H;
  float draw = mix(1.05, clamp(fract(uBar*0.25 + ix*0.08)*2.6, 0., 1.05), uParam.y);
  float turns = 4. + floor(uParam.x*5.);
  for(int s=0;s<2;s++){ float fs = float(s);
    float R = Rb*(1. - clamp(y, 0., 1.));
    float th = y*turns*TAU + uTravel*1.1 + ix*1.7 + fs*PI;
    float xs = R*sin(th);
    float dx = (-Rb*sin(th) + R*cos(th)*turns*TAU)/H;
    float d = abs(q.x - xs)/sqrt(1. + dx*dx);
    float front = 0.12 + 0.88*pow(0.5 + 0.5*cos(th), 2.)*(fs < 0.5 ? 1. : 0.75);
    float vis = step(0., y)*step(y, min(draw, 1.));
    float w = 0.0024 + 0.0018*(1. - y);
    vec3 c = fs < 0.5 ? mix(uPal[0], uPal[2], y) : mix(uPal[1], uPal[3], y);
    float seg = floor(y*140. + fs*70.); float sh = hash11(seg + ix*13.);
    float spark = step(1. - 0.22*uParam.z*(0.6 + uHit), sh)*(0.5 + 0.5*sin(uTime*7. + sh*40.));
    col += c*(exp(-d*d/(w*w))*(1.4 + 2.5*spark) + 0.1*exp(-d/0.012))*front*vis*(0.65 + 0.45*uGlow);
    if(draw < 1.){ float yh = draw; float Rh = Rb*(1. - yh); float thh = yh*turns*TAU + uTravel*1.1 + ix*1.7 + fs*PI;
      vec2 hp = vec2(Rh*sin(thh), yh*H); vec2 o = q - hp; col += vec3(1.)*0.0004/(dot(o, o) + 0.0004)*0.6*smoothstep(0.12, 0.0, length(o)); }
  }
  vec2 tq = q - vec2(0., H + 0.035);
  float sd = sdStar5(tq, 0.045*big, 0.45);
  float on = step(1., draw);
  col += mix(uPal[0], vec3(1.), 0.4)*(smoothstep(0.003, -0.003, sd) + 0.002/(sd*sd + 0.002)*0.1*smoothstep(0.2, 0., sd))*on*(0.7 + 1.2*uHit);
  col += uPal[0]*0.05*exp(-pow(length(q*vec2(1., 5.)), 2.)*30.);
  return col;
}`);

scene('dottree', { name: 'Bubble Tree', cat: 'Christmas', speed: 'any', palette: 'classic', mode: 'same', cells: true, family: ['spiraltree', 'tree'],
  params: [{ name: 'Bubble size', def: 0.5 }, { name: 'Pop on hits', def: 0.7 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(1., floor(uAspect*1.1 + 0.5)); float sp = uAspect/n;
  float ix = floor((p.x + uAspect*0.5)/sp); float cx = (ix + 0.5)*sp - uAspect*0.5;
  float H = 0.82; float yb = -0.44; float W = min(sp*0.46, 0.34);
  float cs = mix(0.03, 0.06, uParam.x);
  vec2 q = vec2(p.x - cx, p.y - yb);
  vec2 g = q/cs; float row = floor(g.y); g.x += mod(row, 2.)*0.5;
  vec2 id = vec2(floor(g.x), row); vec2 f = fract(g) - 0.5; vec2 h = hash22(id + ix*31.);
  vec2 cc = (id + 0.5 + (h - 0.5)*0.2)*cs; cc.x -= mod(row, 2.)*0.5*cs;
  float yy = cc.y/H; float hw = W*(1. - yy);
  if(yy > 0. && yy < 0.97 && abs(cc.x) < hw - cs*0.2){
    float rad = mix(0.22, 0.48, h.x)*(1. + 0.25*yy*0.);
    vec2 cuv = vec2((cc.x + cx)/uAspect + 0.5, cc.y + yb + 0.5);
    float lit = mix(0.35, 1., cellAt(cuv));
    float flare = 0.; for(int k=0;k<4;k++){ vec4 e = uHitEv[k]; if(hash12(id + e.z*17.3) < 0.25) flare = max(flare, evEnv(e, 0.25)); }
    rad *= 1. + 0.3*flare*uParam.y;
    float d = length(f - (h - 0.5)*0.2);
    vec3 c = h.y < 0.7 ? uPal[1] : (h.y < 0.88 ? uPal[2] : uPal[0]);
    col += c*smoothstep(rad, rad - 0.06, d)*(0.55 + 0.45*smoothstep(rad, 0., d))*(lit + flare)*(0.75 + 0.35*uGlow);
  }
  vec2 tq = q - vec2(0., H + 0.02); float sd = sdStar5(tq, 0.05, 0.45);
  col += uPal[2]*(smoothstep(0.003, -0.003, sd)*1.3 + 0.002/(sd*sd + 0.002)*0.1*smoothstep(0.2, 0., sd))*(0.7 + uHit);
  return col;
}`);

scene('presentbow', { name: 'Present Bow', cat: 'Christmas', speed: 'any', palette: 'gift', mode: 'same', family: ['giftwrap', 'ornaments'],
  params: [{ name: 'Paper pattern', def: 0.5 }, { name: 'Shimmer', def: 0.6 }] }, FIG_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec2 g = p*vec2(10., 10.); vec2 id = floor(g); vec2 f = fract(g) - 0.5; f.x += mod(id.y, 2.)*0.0;
  float dots = smoothstep(0.16, 0.12, length(f))*uParam.x;
  vec3 col = uPal[0]*(0.32 + 0.1*fbm3(p*3.)) + uPal[2]*dots*0.35;
  float pulse = 1. + 0.07*evEnv(uHitEv[0], 0.2);
  vec2 kc = vec2(0., 0.08);
  float rw = 0.065;
  float rib = max(smoothstep(rw, rw - 0.004, abs(p.x)), smoothstep(rw, rw - 0.004, abs(p.y - kc.y)));
  float sh = 0.6 + 0.4*sin((p.x + p.y)*28.);
  float band = exp(-pow((fract((p.x - p.y*0.6)*0.35 - uTravel*0.12) - 0.5)*12., 2.))*uParam.y;
  vec3 rc = uPal[2]*(0.55 + 0.3*sh + 1.3*band)*(0.85 + 0.3*uGlow);
  col = mix(col, rc, rib);
  col *= 1. - 0.5*smoothstep(rw + 0.012, rw, abs(p.x))*smoothstep(rw - 0.006, rw, abs(p.x));
  vec2 q = (p - kc)/pulse;
  float loop = 1e3; float inner = 1e3;
  for(int s=0;s<2;s++){ float sd = s == 0 ? -1. : 1.;
    vec2 c = vec2(sd*0.15, 0.07);
    float o = sdEll(q, c, vec2(0.16, 0.095), sd*0.45); float i2 = sdEll(q, c + vec2(-sd*0.02, 0.), vec2(0.1, 0.045), sd*0.45);
    loop = min(loop, o); inner = min(inner, i2);
    loop = min(loop, sdSeg(q, vec2(0.), vec2(sd*0.13, -0.22)) - 0.025 + 0.01*(q.y + 0.22)*sd*0.);
  }
  float knot = length(q*vec2(1., 1.2)) - 0.045;
  float bow = min(loop, knot);
  float bshade = (0.6 + 0.4*smoothstep(-0.02, 0.06, -bow) + 0.35*band)*(1. - 0.55*smoothstep(0.004, -0.01, inner)*step(0.0, knot));
  col = mix(col, uPal[2]*bshade*(0.9 + 0.3*uGlow + 0.4*uHit), smoothstep(0.003, -0.003, bow));
  col += uPal[2]*0.08*exp(-max(bow, 0.)*40.);
  for(int k=0;k<5;k++){ vec4 e = uHitEv[k]; if(e.x > 1.) continue; vec2 sp = vec2((hash11(e.z*7. + float(k)) - 0.5)*0.12, (hash11(e.z*3.1) - 0.5)*uAspect*0.9);
    vec2 pp = hash11(e.z + 1.) < 0.5 ? vec2(sp.x, sp.y) : vec2(sp.y, kc.y + sp.x);
    vec2 o = p - pp; float st = exp(-abs(o.x)/0.002)*exp(-abs(o.y)/0.04) + exp(-abs(o.y)/0.002)*exp(-abs(o.x)/0.04);
    col += vec3(1.)*st*evEnv(e, 0.25)*0.9; }
  return col;
}`);

scene('poinsettia', { name: 'Poinsettias', cat: 'Christmas', speed: 'slow', palette: 'classic', mode: 'same', family: ['wreath', 'presentbow'],
  params: [{ name: 'How many', def: 0.35 }, { name: 'Bloom on hits', def: 0.6 }] }, `
float petal(vec2 q, float L, float W){
  float t = clamp(q.x/L, 0., 1.); float w = W*sin(PI*pow(t, 0.75));
  return max(abs(q.y) - w, max(-q.x, q.x - L));
}
vec3 flower(vec2 q, float bloom, float ang, float spark){
  vec3 col = vec3(0.); float a0 = atan(q.y, q.x) + ang; float r = length(q);
  float leaf = 1e3, outer = 1e3, inner = 1e3;
  for(int k=0;k<6;k++){ float fk = float(k);
    vec2 lq = rot(-(fk*TAU/6. + 0.26 - ang))*q; leaf = min(leaf, petal(lq, 0.56, 0.11));
    vec2 oq = rot(-(fk*TAU/6. - ang))*q; outer = min(outer, petal(oq, 0.5*bloom, 0.13));
    vec2 iq = rot(-(fk*TAU/6. + 0.52 - ang))*q; inner = min(inner, petal(iq, 0.32*bloom, 0.09));
  }
  vec3 green = vec3(0.02, 0.18, 0.05);
  col = mix(col, green*(0.6 + 0.4*smoothstep(0.5, 0., r)), smoothstep(0.004, -0.004, leaf));
  vec3 red = uPal[0];
  col = mix(col, red*(0.55 + 0.45*smoothstep(0.5, 0.05, r))*(0.85 + 0.15*sin(a0*24.)), smoothstep(0.004, -0.004, outer));
  col = mix(col, red*(0.75 + 0.35*smoothstep(0.32, 0.0, r)), smoothstep(0.004, -0.004, inner));
  for(int k=0;k<7;k++){ float fk = float(k); vec2 c = fk < 0.5 ? vec2(0.) : 0.045*vec2(cos(fk*TAU/6.), sin(fk*TAU/6.));
    float d = length(q - c); col = mix(col, uPal[2]*(1. + spark), smoothstep(0.022, 0.016, d)); col += uPal[2]*0.0003/(d*d + 0.0003)*spark*0.2; }
  return col;
}
vec3 scene(vec2 uv, vec2 p){
  float cnt = max(1., floor(mix(1., 3.99, uParam.x)*min(1., uAspect/1.8) + 0.5));
  float spc = uAspect/cnt; float ix = floor((p.x + uAspect*0.5)/spc);
  vec2 c = vec2((ix + 0.5)*spc - uAspect*0.5, 0.);
  float S = min(spc*0.92, 0.95);
  float bloom = 0.82 + 0.2*evEnv(uHitEv[0], 0.6)*uParam.y + 0.06*uGlow;
  vec2 q = (p - c)/S;
  if(length(q) > 0.62) return vec3(0.);
  return flower(q, bloom, uTravel*0.08*(mod(ix, 2.) < 1. ? 1. : -1.), uHit)*(0.8 + 0.3*uGlow);
}`);

scene('jinglebells', { name: 'Jingle Bells', cat: 'Christmas', speed: 'any', palette: 'gold', mode: 'same', family: ['ornaments', 'presentbow'],
  params: [{ name: 'Bells', def: 0.4 }, { name: 'Swing', def: 0.6 }] }, `
float sdBell(vec2 q){
  float y = q.y; float t = clamp((0.4 - y)/0.7, 0., 1.);
  float w = 0.16 + 0.24*t*t*t + 0.05*sin(t*PI);
  float d = max(abs(q.x) - w, max(y - 0.4, -0.3 - y));
  d = min(d, length((q - vec2(0., 0.38))*vec2(1., 1.3)) - 0.16);
  d = min(d, sdRBox(q - vec2(0., -0.31), vec2(0.47, 0.035), 0.03));
  d = min(d, length(q - vec2(0., -0.4)) - 0.07);
  return d;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float n = max(1., floor(mix(2., 6., uParam.x)*uAspect/2.2 + 0.5)); float spc = uAspect/n;
  float gy = 0.4;
  float sag = 0.05*cos((p.x/uAspect)*PI*2.*n);
  col += mix(vec3(0.8, 0.02, 0.05), vec3(1.), 0.0)*smoothstep(0.018, 0.012, abs(p.y - gy - sag))*(0.35 + 0.15*sin(p.x*60.));
  float ix = floor((p.x + uAspect*0.5)/spc); 
  for(int k=-1;k<=1;k++){ float i = ix + float(k); if(i < 0. || i >= n) continue;
    vec2 piv = vec2((i + 0.5)*spc - uAspect*0.5, gy + 0.05*cos((((i + 0.5)*spc - uAspect*0.5)/uAspect)*PI*2.*n));
    float sw = uParam.y*0.4*sin(uBeat*PI + i*0.7)*(0.6 + 0.4*uFlow) + 0.15*uParam.y*evEnv(uHitEv[0], 0.3)*(mod(i, 2.) < 1. ? 1. : -1.);
    float S = min(spc*0.5, 0.42);
    vec2 lp = rot(sw)*(p - piv);
    col += vec3(0.5, 0.04, 0.05)*smoothstep(0.006, 0.003, abs(lp.x))*step(-S*0.18, lp.y)*step(lp.y, 0.);
    vec2 q = (lp + vec2(0., S*0.62))/S;
    float d = sdBell(q);
    float shade = 0.35 + 0.65*smoothstep(-0.45, 0.2, q.x*0.9 + 0.15) ;
    shade += 0.9*exp(-pow((q.x + 0.12)*8., 2.))*step(-0.3, q.y);
    vec3 c = uPal[0]*shade*(0.8 + 0.3*uGlow);
    col = mix(col, c, smoothstep(0.012, -0.012, d));
    col += uPal[0]*0.05*exp(-max(d, 0.)*12.);
    float ring = 0.; for(int j=0;j<3;j++){ vec4 e = uHitEv[j]; if(hash11(i + e.z*9.1) < 0.6) ring = max(ring, evEnv(e, 0.25)); }
    for(int m=0;m<5;m++){ float fm = float(m); float aa = -PI*0.5 + (fm - 2.)*0.55; vec2 sp = q - vec2(0., -0.35) - (0.55 + 0.3*(1. - ring))*vec2(cos(aa), sin(aa));
      col += vec3(1., 0.92, 0.7)*ring*ring*(exp(-abs(sp.x)/0.008)*exp(-abs(sp.y)/0.09) + exp(-abs(sp.y)/0.008)*exp(-abs(sp.x)/0.09)); }
    vec2 sp = q - vec2(-0.2, 0.15); col += vec3(1.)*ring*(exp(-abs(sp.x)/0.006)*exp(-abs(sp.y)/0.12) + exp(-abs(sp.y)/0.006)*exp(-abs(sp.x)/0.12))*0.8;
  }
  return col;
}`);

scene('yulefire', { name: 'Yule Fire', cat: 'Christmas', speed: 'any', palette: 'ember', mode: 'span', family: ['candles', 'aurora'],
  params: [{ name: 'Flame height', def: 0.5 }, { name: 'Sparks', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float y = p.y + 0.5;
  float hx = 0.6 + 0.6*noise(vec2(p.x*2.2, uTime*0.4*uSpeed));
  float h = (0.28 + 0.4*uParam.x)*hx*(0.85 + 0.45*uHit + 0.25*uGlow);
  float n = fbm(vec2(p.x*3.2, y*2.4 - uTime*1.7*uSpeed));
  float n2 = fbm(vec2(p.x*7., y*5. - uTime*3.*uSpeed) + 7.);
  float sh = 1. - y/h + (n - 0.5)*1.1 + (n2 - 0.5)*0.35 - 0.45*smoothstep(0.35, 0.7, noise(vec2(p.x*4.5, uTime*0.7*uSpeed)));
  float f = smoothstep(0., 0.9, sh);
  vec3 c = mix(uPal[3]*0.4, uPal[0], smoothstep(0., 0.35, f));
  c = mix(c, uPal[1], smoothstep(0.35, 0.7, f)); c = mix(c, uPal[2], smoothstep(0.7, 1., f));
  col += c*f*1.3;
  col += uPal[0]*0.08*exp(-y*3.)*(0.6 + 0.4*uGlow);
  for(int l=0;l<2;l++){ float fl = float(l);
    vec2 g = vec2(p.x*(30. + fl*20.), (y - uTime*(0.35 + 0.2*fl)*uSpeed)*(18. + fl*10.)); vec2 id = floor(g); vec2 hh = hash22(id + fl*9.);
    float on = step(1. - (0.05 + 0.12*uParam.y)*(0.5 + uBand1.z + uAcc), hh.x);
    vec2 o = fract(g) - 0.5 - (hh - 0.5)*0.5; o.x += 0.3*sin(uTime*3. + hh.y*20.);
    col += mix(uPal[1], uPal[2], hh.y)*on*smoothstep(0.18, 0.02, length(o))*smoothstep(0.95, 0.2, y)*(0.6 + 0.6*sin(uTime*10. + hh.y*30.));
  }
  float logs = max(smoothstep(0.045, 0.04, abs(rot(0.12)*vec2(p.x, y - 0.07)).y)*step(abs(p.x), uAspect*0.33), smoothstep(0.045, 0.04, abs(rot(-0.1)*vec2(p.x, y - 0.06)).y)*step(abs(p.x), uAspect*0.28));
  col = mix(col, vec3(0.025, 0.01, 0.004) + uPal[0]*0.25*smoothstep(0.02, 0.05, y)*smoothstep(0.12, 0.05, y)*0.3, logs);
  return col;
}`);

/* ------------------------------------------------------------------ Music */
scene('pianokeys', { name: 'Piano Keys', cat: 'Music', speed: 'any', palette: 'club', mode: 'span', react: { hit: 'melody', acc: 'bass' }, family: ['musicnotes', 'eqbars'],
  params: [{ name: 'Keys', def: 0.5 }, { name: 'Light beams', def: 0.6 }] }, `
float keyPress(float key, float nW, float black){
  float pr = 0.;
  for(int k=0;k<8;k++){ vec4 e = black > 0.5 ? uAccEv[k] : uHitEv[k]; if(e.x > 3.) continue;
    float kk = floor(fract(e.z*7.31 + black*0.37)*nW);
    if(kk == key) pr = max(pr, evEnv(e, 0.35));
    if(black < 0.5 && kk + 2. == key) pr = max(pr, evEnv(e, 0.35)*0.7);
  }
  return pr;
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float nW = floor(uAspect*mix(5., 12., uParam.x)); float kw = uAspect/nW;
  float kh = 0.4; float yt = -0.5 + kh;
  float kx = (p.x + uAspect*0.5)/kw; float wi = floor(kx); float fx = fract(kx);
  float y = p.y;
  float glowAmt = 0.75 + 0.35*uGlow;
  if(y < yt){
    float pr = keyPress(wi, nW, 0.);
    float gapw = smoothstep(0., 0.04, fx)*smoothstep(1., 0.96, fx);
    vec3 kc = mix(vec3(0.62)*(0.75 + 0.25*smoothstep(-0.5, yt, y)), pal(wi/nW)*2., smoothstep(0.02, 0.45, pr));
    kc *= 1. - 0.25*pr*smoothstep(yt - 0.03, yt, y);
    col = kc*gapw*glowAmt;
    float m = mod(wi, 7.); float hasR = (m == 0. || m == 1. || m == 3. || m == 4. || m == 5.) ? 1. : 0.;
    float mL = mod(wi - 1., 7.); float hasL = (mL == 0. || mL == 1. || mL == 3. || mL == 4. || mL == 5.) ? 1. : 0.;
    float isB = 0.; float bk = -1.;
    if(fx > 0.68 && hasR > 0.5) { isB = 1.; bk = wi; }
    if(fx < 0.32 && hasL > 0.5) { isB = 1.; bk = wi - 1.; }
    if(isB > 0.5 && y > yt - kh*0.6){
      float bp = keyPress(bk, nW, 1.);
      col = (vec3(0.02) + vec3(0.05)*smoothstep(yt - kh*0.6, yt, y) + pal(bk/nW + 0.5)*bp*2.2)*glowAmt;
    }
    col += uPal[0]*0.6*smoothstep(0.006, 0., abs(y - yt))*glowAmt;
  } else {
    for(int k=0;k<8;k++){ vec4 e = uHitEv[k]; if(e.x > 2.5) continue;
      float kk = floor(fract(e.z*7.31)*nW); float cxk = (kk + 0.5)*kw - uAspect*0.5;
      float top = yt + e.x*0.9; float bot = yt + max(0., e.x - 0.5)*0.9;
      float inb = smoothstep(bot - 0.02, bot + 0.05, y)*smoothstep(top + 0.02, top - 0.04, y);
      float dx = abs(p.x - cxk);
      vec3 c = pal(kk/nW);
      col += c*(exp(-dx*dx/(kw*kw*0.12)) + 0.3*exp(-dx/(kw*0.7)))*inb*e.y*exp(-e.x*0.9)*uParam.y*1.6;
      vec2 o = p - vec2(cxk, top); col += mix(c, vec3(1.), 0.5)*0.0006/(dot(o, o) + 0.0006)*exp(-e.x*1.2)*e.y*uParam.y;
    }
    col += uPal[0]*0.03*exp(-(y - yt)*10.)*glowAmt;
  }
  return col;
}`);

scene('musicnotes', { name: 'Music Notes', cat: 'Music', speed: 'any', palette: 'club', mode: 'same', react: { hit: 'melody' }, family: ['pianokeys', 'starshower'],
  params: [{ name: 'Floating notes', def: 0.5 }, { name: 'Bursts on hits', def: 0.7 }, { name: 'Neon', def: 0.6 }] }, `
float sdEll2(vec2 p, vec2 c, vec2 r, float a){ vec2 q = rot(a)*(p - c); return (length(q/r) - 1.)*min(r.x, r.y); }
float sdNote(vec2 q, float kind){
  float d = sdEll2(q, vec2(0.), vec2(0.2, 0.14), 0.4);
  d = min(d, sdSeg(q, vec2(0.18, 0.04), vec2(0.18, 0.78)) - 0.028);
  if(kind < 0.5){ d = min(d, sdSeg(q, vec2(0.18, 0.78), vec2(0.38, 0.5)) - 0.03); }
  else { d = min(d, sdEll2(q, vec2(0.62, 0.08), vec2(0.2, 0.14), 0.4)); d = min(d, sdSeg(q, vec2(0.8, 0.12), vec2(0.8, 0.84)) - 0.028);
         d = min(d, sdSeg(q, vec2(0.18, 0.76), vec2(0.8, 0.82)) - 0.05); }
  return d;
}
vec3 noteCol(float d, vec3 c, float neon){
  float fill = smoothstep(0.02, -0.02, d);
  float line = exp(-pow(abs(d)/0.03, 2.)) + 0.2*exp(-abs(d)/0.045);
  return c*mix(fill, line*1.4, neon);
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float neon = uParam.z;
  if(uParam.x > 0.02){
    float cs = 0.2; vec2 q = p; q.y -= uTravel*0.12; vec2 g = q/cs; vec2 id = floor(g); vec2 h = hash22(id + 2.);
    if(h.x < 0.2 + 0.6*uParam.x){
      vec2 f = (fract(g) - 0.5 - (h - 0.5)*0.3)*cs; f.x += 0.02*sin(uTime*1.5 + h.y*20.);
      float sz = 0.07 + 0.035*h.y;
      vec2 lq = rot(0.3*sin(uBeat*PI*0.5 + h.x*6.))*(f + vec2(0.02, 0.03))/sz;
      col += noteCol(sdNote(lq, step(0.5, h.y)), pal(h.y + h.x*0.3), neon)*(0.5 + 0.4*uGlow);
    }
  }
  for(int k=0;k<5;k++){ vec4 e = uHitEv[k]; if(e.x > 1.6) continue;
    for(int j=0;j<6;j++){ float fj = float(j);
      float a = e.z*TAU + fj*TAU/6. + 0.3*sin(fj*3.1 + e.z*10.);
      float dist = (0.05 + e.x*(0.35 + 0.2*hash11(fj + e.z*5.)))*(0.6 + 0.4*uAspect);
      vec2 pos = vec2(cos(a)*dist*1.3, sin(a)*dist);
      float sz = 0.07*(0.7 + 0.6*hash11(fj*1.3 + e.z));
      vec2 o = p - pos; if(dot(o, o) > sz*sz*2.5) continue;
      vec2 lq = rot(a*0.3 + e.x*2.)*(o + vec2(0.02, 0.02))/sz;
      col += noteCol(sdNote(lq, mod(fj, 2.)), pal(fj*0.25 + e.z), neon)*e.y*exp(-e.x*1.6)*uParam.y*1.4;
    }
  }
  return col;
}`);

/* ------------------------------------------------------------------ Winter / motion */
const FLAKE_GLSL = `
float sdFlake(vec2 p, float r){
  float l = length(p); float a = atan(p.y, p.x); a = mod(a + PI/6., PI/3.) - PI/6.;
  vec2 q = l*vec2(cos(a), abs(sin(a)));
  float d = sdSeg(q, vec2(0.), vec2(r, 0.));
  d = min(d, sdSeg(q, vec2(r*0.42, 0.), vec2(r*0.62, r*0.2)));
  d = min(d, sdSeg(q, vec2(r*0.68, 0.), vec2(r*0.82, r*0.13)));
  return d;
}`;
scene('goldsnow', { name: 'Golden Snowflakes', cat: 'Winter', speed: 'slow', palette: 'gold', mode: 'span', family: ['snowstorm', 'neonflakes'],
  params: [{ name: 'Amount', def: 0.5 }, { name: 'Glitter', def: 0.6 }, { name: 'Dreamy blur', def: 0.5 }] }, FLAKE_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  for(int l=0;l<3;l++){ float fl = float(l);
    float cs = mix(0.07, 0.2, fl/2.);
    vec2 q = p; q.y += uTravel*(0.05 + 0.04*fl) + fl*0.31; q.x += fl*0.77;
    vec2 g = q/cs; vec2 id = floor(g); vec2 h = hash22(id + fl*7.);
    if(h.x > 0.25 + 0.5*uParam.x) continue;
    vec2 f = (fract(g) - 0.5 - (h - 0.5)*0.3)*cs; f.x += 0.015*sin(uTime*0.8 + h.y*10.);
    float r = cs*mix(0.22, 0.34, h.y);
    vec2 lq = rot(uTime*0.25*(h.x - 0.12)*uSpeed + h.y*6.)*f;
    float d = sdFlake(lq, r);
    float blur = fl == 2. ? uParam.z : fl == 1. ? uParam.z*0.3 : 0.;
    float w = r*(0.05 + 0.25*blur);
    vec3 c = mix(uPal[0], uPal[1], h.y*0.6);
    float tw = 0.65 + 0.35*sin(uTime*2. + h.y*30.);
    col += c*(exp(-d*d/(w*w))*1.2/(1. + blur*2.) + 0.08*exp(-d/(r*0.4)))*(0.45 + 0.25*fl)*tw*(0.8 + 0.3*uGlow + 0.4*uHit);
  }
  vec2 g = p*vec2(70., 70.) + vec2(0., uTravel*3.); vec2 id = floor(g); vec2 h = hash22(id + 3.);
  float on = step(1. - 0.07*uParam.y*(0.6 + 1.5*uHit), h.x);
  col += mix(uPal[1], vec3(1.), h.y)*on*smoothstep(0.3, 0.05, length(fract(g) - 0.5))*(0.4 + 0.6*sin(uTime*6. + h.y*40.));
  col += uPal[0]*0.025*exp(-pow((p.y + 0.5)*3., 2.));
  return col;
}`);

scene('neonflakes', { name: 'Neon Snowflakes', cat: 'Winter', speed: 'any', palette: 'icy', mode: 'span', family: ['goldsnow', 'snowflake'],
  params: [{ name: 'Amount', def: 0.45 }, { name: 'Spin', def: 0.5 }] }, FLAKE_GLSL + `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  for(int l=0;l<2;l++){ float fl = float(l);
    float cs = mix(0.16, 0.26, fl);
    vec2 q = p; q.y += uTravel*(0.07 + 0.05*fl) + fl*0.5; q.x += fl*0.9;
    vec2 g = q/cs; vec2 id = floor(g); vec2 h = hash22(id + fl*5.);
    if(h.x > 0.25 + 0.55*uParam.x) continue;
    vec2 f = (fract(g) - 0.5 - (h - 0.5)*0.25)*cs;
    float r = cs*mix(0.25, 0.36, h.y);
    float pulse = 1. + 0.12*evEnv(uHitEv[0], 0.2);
    vec2 lq = rot(uTravel*(0.4 + 1.2*uParam.y)*(h.y < 0.5 ? 1. : -1.) + h.x*6.)*f/pulse;
    float d = sdFlake(lq, r);
    vec3 c = palc(int(h.y*3.99));
    col += c*(exp(-d*d/(0.0035*0.0035))*1.4 + 0.12*exp(-d/0.006))*(0.7 + 0.3*fl)*(0.8 + 0.4*uGlow + 0.5*uHit);
  }
  return col;
}`);

scene('lightstreaks', { name: 'Rising Light Streaks', cat: 'Big motion', speed: 'fast', palette: 'bethlehem', mode: 'span', family: ['starshower', 'goldsnow'],
  params: [{ name: 'Streaks', def: 0.5 }, { name: 'Launch on hits', def: 0.8 }] }, `
vec3 streak(vec2 p, float x, float yh, float L, float w, vec3 c){
  float dx = abs(p.x - x); float t = (yh - p.y)/L;
  float body = step(0., t)*exp(-t*2.5)*exp(-dx*dx/(w*w));
  vec2 o = p - vec2(x, yh); float head = 0.00025/(dot(o, o) + 0.00025);
  return c*(body*1.2 + head*0.5);
}
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float cw = 0.035; float ci = floor(p.x/cw);
  for(int k=-1;k<=1;k++){ float i = ci + float(k); vec2 h = hash22(vec2(i, 3.7));
    if(h.x > 0.15 + 0.4*uParam.x) continue;
    float sp = 0.35 + 0.5*h.y; float ph = fract(uTime*sp*0.35*uSpeed + h.x*7.);
    float yh = -0.6 + ph*1.4; float x = (i + 0.5)*cw + (h.y - 0.5)*cw*0.5;
    col += streak(p, x, yh, 0.18 + 0.2*h.x, 0.0018, mix(uPal[0], uPal[2], step(0.6, h.y)))*(0.5 + 0.4*uGlow)*(1. - ph);
  }
  for(int k=0;k<6;k++){ vec4 e = uHitEv[k]; if(e.x > 1.6) continue;
    for(int j=0;j<4;j++){ float fj = float(j);
      float x = (hash11(e.z*13.1 + fj*3.7) - 0.5)*uAspect*0.95; float sp = 0.9 + 0.6*hash11(fj + e.z*4.);
      float yh = -0.55 + e.x*sp; float L = 0.3 + 0.2*hash11(fj*7. + e.z);
      col += streak(p, x, yh, L, 0.0022, mix(uPal[0], uPal[2], hash11(fj + e.z*2.)))*e.y*exp(-e.x*1.2)*uParam.y*1.5;
    }
  }
  vec2 g = p*vec2(60., 40.) - vec2(0., uTravel*2.); vec2 id = floor(g); vec2 h = hash22(id + 9.);
  col += mix(uPal[0], uPal[3], h.y)*step(0.95, h.x)*smoothstep(0.3, 0.05, length(fract(g) - 0.5))*(0.3 + 0.4*sin(uTime*5. + h.y*30.))*smoothstep(0.5, -0.5, p.y);
  col += uPal[0]*0.08*exp(-(p.y + 0.5)*7.)*(0.6 + 0.6*uGlow);
  return col;
}`);

scene('bokeh', { name: 'Bokeh Lights', cat: 'Christmas Lights', speed: 'slow', palette: 'warm', mode: 'span', family: ['twinkle', 'goldsnow'],
  params: [{ name: 'Amount', def: 0.5 }, { name: 'Size', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  for(int l=0;l<3;l++){ float fl = float(l);
    float cs = mix(0.09, 0.24, fl/2.)*mix(0.7, 1.4, uParam.y);
    vec2 q = p + vec2(uTravel*0.02*(fl + 1.), sin(uTravel*0.1 + fl)*0.05) + fl*0.71;
    vec2 g = q/cs; vec2 id = floor(g); vec2 h = hash22(id + fl*11.);
    if(h.x > 0.3 + 0.5*uParam.x) continue;
    vec2 f = (fract(g) - 0.5 - (h - 0.5)*0.4)*cs;
    float r = cs*mix(0.22, 0.42, h.y); float d = length(f);
    float disc = smoothstep(r, r*0.9, d)*(0.6 + 0.4*smoothstep(r*0.5, r*0.95, d));
    float flare = 0.; for(int k=0;k<3;k++){ vec4 e = uHitEv[k]; if(hash12(id + e.z*7.7) < 0.3) flare = max(flare, evEnv(e, 0.3)); }
    float tw = 0.55 + 0.45*sin(uTime*(0.5 + h.y)*uSpeed + h.x*20.);
    col += pal(h.y*0.8 + fl*0.1)*disc*(0.12 + 0.06*fl)*(tw + 1.5*flare)*(0.8 + 0.5*uGlow);
  }
  return col;
}`);

scene('glitterrain', { name: 'Glitter Equalizer', cat: 'Big motion', speed: 'fast', palette: 'aurora', mode: 'span', family: ['eqbars', 'lightstreaks'],
  params: [{ name: 'Density', def: 0.5 }, { name: 'Wave height', def: 0.6 }] }, `
vec3 scene(vec2 uv, vec2 p){
  vec3 col = vec3(0.);
  float lvl = 0.35*uBand0.y + 0.35*uBand1.x + 0.3*uBand1.w;
  float cw = 0.009; float ci = floor(p.x/cw); vec2 hc = hash22(vec2(ci, 1.3));
  float amp = (0.04 + 0.32*uParam.y*lvl*(0.5 + noise(vec2(ci*0.15, uTime*2.))) + 0.12*uHit*hc.y)*(0.6 + 0.4*hc.x);
  float wave = 0.03*sin(p.x*9. + uTime*2.)*(0.4 + lvl);
  float dy = abs(p.y - wave);
  if(hc.x < 0.35 + 0.5*uParam.x){
    float v = p.y*40. + uTravel*(6. + 6.*hc.y)*sign(p.y - wave);
    float dotv = smoothstep(0.35, 0.05, abs(fract(v) - 0.5))*step(0.5, hash11(floor(v) + ci*7.));
    float inside = smoothstep(amp, amp*0.6, dy);
    float xf = abs(fract(p.x/cw) - 0.5);
    col += mix(uPal[0], uPal[1], hc.y)*dotv*inside*smoothstep(0.4, 0.1, xf)*(0.8 + 0.5*uGlow);
  }
  col += mix(uPal[1], vec3(1.), 0.4)*(exp(-dy*dy/(0.003*0.003))*1.2 + 0.0004/(dy*dy + 0.0004)*0.08)*(0.6 + 0.6*lvl + 0.5*uHit);
  vec2 g = p*vec2(50., 30.) + vec2(0., uTravel*1.5); vec2 id = floor(g); vec2 h = hash22(id + 5.);
  col += uPal[1]*step(0.97, h.x)*smoothstep(0.3, 0.05, length(fract(g) - 0.5))*0.35;
  return col;
}`);

/* ------------------------------------------------------------------ Patterns */
scene('kaleido', { name: 'Kaleidoscope', cat: 'Patterns', speed: 'any', palette: 'jewel', mode: 'same', family: ['rosewindow', 'lollipop'],
  params: [{ name: 'Mirrors', def: 0.4 }, { name: 'Zoom on hits', def: 0.6 }, { name: 'Neon lines', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  float k = floor(6. + uParam.x*10.);
  float zoom = 1. - 0.18*uParam.y*evEnv(uHitEv[0], 0.25);
  vec2 q = p*zoom; float r = length(q);
  float a = atan(q.y, q.x) + uTravel*0.15 + (max(uHitEv[0].w, 0.) + smoothstep(0., 0.3, min(uHitEv[0].x, 1.)))*0.2*uParam.y;
  float seg = TAU/k; a = mod(a, seg); a = abs(a - seg*0.5);
  vec2 m = r*vec2(cos(a), sin(a));
  float t = uTravel*0.3;
  float n = fbm3(m*2.6 + vec2(t*0.35, -t*0.22));
  float ct = abs(fract(n*5. - t*0.25) - 0.5);
  vec3 col = pal(n*1.6 + r*0.4 - t*0.1)*(0.12 + 0.9*smoothstep(0.09, 0.0, ct - 0.02*(1. - uParam.z)));
  col += pal(r*1.2 - t*0.2)*smoothstep(0.04, 0.0, abs(fract(r*3.5 - t*0.6) - 0.5) - 0.01)*0.35;
  float d1 = sdStar5(rot(t)*(m - vec2(0.24 + 0.06*sin(t*1.3), 0.02)), 0.055, 0.45);
  col += pal(0.25 + t*0.1)*(smoothstep(0.004, -0.004, d1)*(1. - uParam.z*0.6) + exp(-pow(abs(d1)/0.006, 2.))*uParam.z*1.4);
  col *= (0.7 + 0.35*uGlow + 0.4*uHit);
  col += mix(palc(0), vec3(1.), 0.6)*exp(-r*14.)*(0.5 + uHit);
  return col;
}`);

scene('giftwrap', { name: 'Gift Wrap', cat: 'Patterns', speed: 'any', palette: 'gift', mode: 'span', cells: true, family: ['presentbow', 'stripes'],
  params: [{ name: 'Pattern (auto, plaid, dots, diamonds, argyle)', def: 0.0 }, { name: 'Scroll', def: 0.4 }, { name: 'Scale', def: 0.5 }] }, `
vec3 scene(vec2 uv, vec2 p){
  float sel = uParam.x < 0.2 ? mod(floor(uBar/4.), 4.) : floor((uParam.x - 0.2)/0.2001);
  float sc = mix(4., 10., uParam.z);
  vec2 q = p*sc + vec2(1., -1.)*uTravel*0.4*uParam.y;
  vec3 c;
  if(sel < 0.5){ // plaid
    vec2 f = fract(q*0.5);
    float sx = smoothstep(0.48, 0.52, f.x), sy = smoothstep(0.48, 0.52, f.y);
    float lx = smoothstep(0.03, 0., abs(f.x - 0.25)), ly = smoothstep(0.03, 0., abs(f.y - 0.25));
    c = uPal[0]*(0.25 + 0.4*sx + 0.4*sy) + uPal[1]*0.25*sx*sy + uPal[2]*0.6*max(lx, ly);
  } else if(sel < 1.5){ // polka dots
    vec2 g = q; g.x += mod(floor(g.y), 2.)*0.5; vec2 f = fract(g) - 0.5;
    float dd = length(f); c = uPal[1]*0.4 + mix(uPal[3], uPal[2], step(0.5, hash12(floor(g))))*smoothstep(0.24, 0.2, dd)*0.9;
  } else if(sel < 2.5){ // diamonds
    vec2 r = rot(PI*0.25)*q*0.8; vec2 f = abs(fract(r) - 0.5);
    float dm = max(f.x, f.y); c = mix(uPal[0]*0.45, uPal[3]*0.85, smoothstep(0.36, 0.33, dm)*step(0.5, mod(floor(r.x) + floor(r.y), 2.)));
    c += uPal[2]*smoothstep(0.03, 0., abs(dm - 0.47))*0.5;
  } else { // argyle
    vec2 r = vec2(q.x*0.6, q.y*0.4); vec2 g = vec2(r.x + r.y, r.x - r.y); vec2 id = floor(g); vec2 f = fract(g);
    c = mod(id.x + id.y, 2.) < 1. ? uPal[0]*0.5 : uPal[1]*0.5;
    c += uPal[3]*0.6*smoothstep(0.03, 0., min(abs(fract(g.x + 0.5) - 0.5), abs(fract(g.y + 0.5) - 0.5)))*0.6;
  }
  float lit = mix(0.5, 1., cellAt(uv))*(0.75 + 0.3*uGlow + 0.35*uHit);
  return c*lit;
}`);

const SCENE_ORDER3 = ['sparkleangels', 'peppermint', 'candytunnel', 'candyrain', 'stripes', 'lollipop', 'candycarousel', 'lightframe', 'bokeh', 'spiraltree', 'dottree',
  'presentbow', 'poinsettia', 'jinglebells', 'yulefire', 'goldsnow', 'neonflakes', 'pianokeys', 'musicnotes', 'lightstreaks', 'glitterrain', 'kaleido', 'giftwrap'];
