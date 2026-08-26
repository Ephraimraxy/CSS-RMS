import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, ArrowRight, CheckCircle2, Building2, Eye, EyeOff, Smartphone, HelpCircle, X, PhoneCall, ChevronDown, GitBranch, AlertTriangle, Fingerprint } from 'lucide-react';
import { getDepartments } from '../lib/store';
import { toast } from 'react-hot-toast';
import { isNative, bioAvailable, hasBioDept, getSavedBioDepts, enrollBiometric, loginWithBiometric } from '../lib/biometric';

// ── Detailed SVG flora, fauna & farm icons ──────────────────────────────────
const SunflowerIcon = ({ color = '#fbbf24', size = 40 }) => {
  const r = size / 2;
  const center = size * 0.22;
  return (
    <svg width={size} height={size + size * 0.6} viewBox={`0 0 ${size} ${size + size * 0.6}`} fill="none">
      <path d={`M${r} ${size * 0.9} Q${r-size*.12} ${size*1.15} ${r-size*.06} ${size*1.55}`} stroke="#4ade80" strokeWidth={size*.07} strokeLinecap="round"/>
      <ellipse cx={r-size*.19} cy={size*1.22} rx={size*.17} ry={size*.09} fill="#4ade80" transform={`rotate(-35 ${r-size*.19} ${size*1.22})`} opacity=".9"/>
      {[0,45,90,135,180,225,270,315].map((deg,i)=>(
        <ellipse key={i}
          cx={r+Math.cos((deg-90)*Math.PI/180)*(r-center*.4)}
          cy={r+Math.sin((deg-90)*Math.PI/180)*(r-center*.4)}
          rx={size*.12} ry={size*.29} fill={color} opacity=".92"
          transform={`rotate(${deg} ${r+Math.cos((deg-90)*Math.PI/180)*(r-center*.4)} ${r+Math.sin((deg-90)*Math.PI/180)*(r-center*.4)})`}/>
      ))}
      <circle cx={r} cy={r} r={center} fill="#78350f"/>
      <circle cx={r} cy={r} r={center*.65} fill="#92400e"/>
      {[0,60,120,180,240,300].map((deg,i)=>(
        <circle key={i} cx={r+Math.cos(deg*Math.PI/180)*center*.38} cy={r+Math.sin(deg*Math.PI/180)*center*.38} r={center*.1} fill="#fbbf24" opacity=".7"/>
      ))}
    </svg>
  );
};

const TropicalLeafIcon = ({ color = '#fb923c', size = 36 }) => (
  <svg width={size*.68} height={size} viewBox="0 0 34 52" fill="none">
    <path d="M17 50 C5 36 1 24 1 15 C1 5 17 0 17 0 C17 0 33 5 33 15 C33 24 29 36 17 50Z" fill={color} opacity=".88"/>
    <path d="M17 48 Q16 30 17 4" stroke="rgba(0,0,0,.2)" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
    {[12,20,28,36].map((y,i)=>(
      <g key={i}>
        <path d={`M17 ${y} Q10 ${y-4} 6 ${y-2}`} stroke="rgba(0,0,0,.15)" strokeWidth=".9" fill="none" strokeLinecap="round"/>
        <path d={`M17 ${y} Q24 ${y-4} 28 ${y-2}`} stroke="rgba(0,0,0,.15)" strokeWidth=".9" fill="none" strokeLinecap="round"/>
      </g>
    ))}
    <path d="M20 6 Q26 12 25 24" stroke="rgba(255,255,255,.22)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
  </svg>
);

const FlowerIcon = ({ color = '#f87171', size = 32 }) => {
  const r = size/2; const pr = r*.55;
  return (
    <svg width={size} height={size+size*.55} viewBox={`0 0 ${size} ${size+size*.55}`} fill="none">
      <path d={`M${r} ${size*.88} Q${r+size*.1} ${size*1.12} ${r+size*.05} ${size*1.48}`} stroke="#4ade80" strokeWidth={size*.065} strokeLinecap="round"/>
      <ellipse cx={r+size*.16} cy={size*1.16} rx={size*.15} ry={size*.08} fill="#4ade80" transform={`rotate(30 ${r+size*.16} ${size*1.16})`} opacity=".85"/>
      {[0,72,144,216,288].map((deg,i)=>(
        <ellipse key={i}
          cx={r+Math.cos((deg-90)*Math.PI/180)*pr} cy={r+Math.sin((deg-90)*Math.PI/180)*pr}
          rx={r*.32} ry={r*.52} fill={color} opacity=".9"
          transform={`rotate(${deg} ${r+Math.cos((deg-90)*Math.PI/180)*pr} ${r+Math.sin((deg-90)*Math.PI/180)*pr})`}/>
      ))}
      <circle cx={r} cy={r} r={r*.28} fill="#fde047"/>
      <circle cx={r} cy={r} r={r*.14} fill="#fbbf24"/>
    </svg>
  );
};

const DetailedTractorIcon = ({ color = '#fbbf24', size = 48 }) => (
  <svg width={size*1.65} height={size} viewBox="0 0 80 50" fill="none">
    {/* rear wheel */}
    <circle cx="22" cy="34" r="15" stroke={color} strokeWidth="3" fill="none"/>
    <circle cx="22" cy="34" r="9.5" stroke={color} strokeWidth="1.2" fill="none" opacity=".35"/>
    <circle cx="22" cy="34" r="3.5" fill={color} opacity=".75"/>
    {[0,60,120,180,240,300].map((d,i)=>(
      <line key={i} x1={22+Math.cos(d*Math.PI/180)*4} y1={34+Math.sin(d*Math.PI/180)*4}
        x2={22+Math.cos(d*Math.PI/180)*9} y2={34+Math.sin(d*Math.PI/180)*9}
        stroke={color} strokeWidth="1.6" opacity=".65" strokeLinecap="round"/>
    ))}
    {/* front wheel */}
    <circle cx="60" cy="38" r="8.5" stroke={color} strokeWidth="2.2" fill="none"/>
    <circle cx="60" cy="38" r="4.5" stroke={color} strokeWidth="1" fill="none" opacity=".4"/>
    <circle cx="60" cy="38" r="2" fill={color} opacity=".7"/>
    {[0,90,180,270].map((d,i)=>(
      <line key={i} x1={60+Math.cos(d*Math.PI/180)*2.6} y1={38+Math.sin(d*Math.PI/180)*2.6}
        x2={60+Math.cos(d*Math.PI/180)*4.2} y2={38+Math.sin(d*Math.PI/180)*4.2}
        stroke={color} strokeWidth="1.3" opacity=".55" strokeLinecap="round"/>
    ))}
    {/* chassis */}
    <path d="M22 34 L22 21 L38 19 L53 21 L60 26 L60 38" stroke={color} strokeWidth="1.2" fill="none" opacity=".28"/>
    {/* hood */}
    <rect x="35" y="19" width="23" height="14" rx="2.5" fill={color} opacity=".82"/>
    {/* cab */}
    <rect x="13" y="10" width="24" height="17" rx="3" fill={color} opacity=".76"/>
    {/* window */}
    <rect x="15" y="12" width="9" height="9" rx="1.5" fill="rgba(255,255,255,.36)"/>
    <rect x="26" y="12" width="7" height="9" rx="1.5" fill="rgba(255,255,255,.2)"/>
    {/* exhaust */}
    <rect x="52" y="5" width="4.5" height="15" rx="2.2" fill={color} opacity=".72"/>
    <ellipse cx="54" cy="4" rx="3.5" ry="2" fill={color} opacity=".5"/>
    <circle cx="54" cy="1.5" r="2" fill={color} opacity=".22"/>
    <circle cx="57" cy="0" r="1.3" fill={color} opacity=".14"/>
    {/* fender */}
    <path d="M8 23 Q14 16 22 18 Q31 20 35 23" stroke={color} strokeWidth="2.8" fill="none" opacity=".6" strokeLinecap="round"/>
    {/* shadow */}
    <ellipse cx="38" cy="49" rx="28" ry="2.5" fill={color} opacity=".1"/>
  </svg>
);

const PalmLeafIcon = ({ color = '#ffffff', size = 38 }) => (
  <svg width={size} height={size*1.1} viewBox="0 0 38 42" fill="none">
    <path d="M19 40 Q18 32 19 22" stroke="#4ade80" strokeWidth="2" strokeLinecap="round"/>
    {['M19 22 Q4 16 2 6','M19 22 Q14 8 16 2','M19 22 Q24 8 22 2','M19 22 Q34 16 36 6'].map((d,i)=>(
      <path key={i} d={d} stroke={color} strokeWidth="2.3" strokeLinecap="round" fill="none" opacity=".85"/>
    ))}
    {['M19 22 Q6 22 2 18','M19 22 Q32 22 36 18'].map((d,i)=>(
      <path key={i} d={d} stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none" opacity=".55"/>
    ))}
    {[[4,8],[15,3],[22,3],[35,7]].map(([cx,cy],i)=>(
      <ellipse key={i} cx={cx} cy={cy} rx="4.5" ry="2.2" fill={color} opacity=".32" transform={`rotate(${i*25-30} ${cx} ${cy})`}/>
    ))}
  </svg>
);

const BeeIcon = ({ color = '#fbbf24', size = 30 }) => (
  <svg width={size*1.4} height={size} viewBox="0 0 56 38" fill="none">
    {/* wings */}
    <ellipse cx="21" cy="10" rx="14" ry="7" fill="rgba(255,255,255,0.55)" transform="rotate(-20 21 10)"/>
    <ellipse cx="21" cy="24" rx="11" ry="5.5" fill="rgba(255,255,255,0.4)" transform="rotate(20 21 24)"/>
    <ellipse cx="37" cy="10" rx="14" ry="7" fill="rgba(255,255,255,0.55)" transform="rotate(20 37 10)"/>
    <ellipse cx="37" cy="24" rx="11" ry="5.5" fill="rgba(255,255,255,0.4)" transform="rotate(-20 37 24)"/>
    {/* body */}
    <ellipse cx="29" cy="21" rx="8" ry="13" fill={color}/>
    {/* stripes */}
    <rect x="21.5" y="16" width="15" height="3.5" rx="1.5" fill="#1a1a1a" opacity=".7"/>
    <rect x="21.5" y="22" width="15" height="3.5" rx="1.5" fill="#1a1a1a" opacity=".7"/>
    <rect x="21.5" y="28" width="15" height="3" rx="1.5" fill="#1a1a1a" opacity=".5"/>
    {/* head */}
    <circle cx="29" cy="9" r="5.5" fill={color}/>
    <circle cx="27" cy="7.5" r="1.5" fill="#1a1a1a" opacity=".8"/>
    <circle cx="31" cy="7.5" r="1.5" fill="#1a1a1a" opacity=".8"/>
    {/* antennae */}
    <path d="M27 4 Q23 0 20 1" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity=".7"/>
    <path d="M31 4 Q35 0 38 1" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity=".7"/>
    <circle cx="20" cy="1" r="1.2" fill="#1a1a1a" opacity=".7"/>
    <circle cx="38" cy="1" r="1.2" fill="#1a1a1a" opacity=".7"/>
    {/* stinger */}
    <path d="M29 34 L29 38" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" opacity=".6"/>
  </svg>
);

const ButterflyIcon = ({ color = '#f87171', size = 34 }) => (
  <svg width={size*1.6} height={size} viewBox="0 0 56 36" fill="none">
    {/* upper wings */}
    <path d="M28 18 Q14 2 4 6 Q0 14 8 22 Q16 26 28 18Z" fill={color} opacity=".88"/>
    <path d="M28 18 Q42 2 52 6 Q56 14 48 22 Q40 26 28 18Z" fill={color} opacity=".88"/>
    {/* lower wings */}
    <path d="M28 18 Q10 20 8 30 Q14 36 24 30 Q28 26 28 18Z" fill={color} opacity=".7"/>
    <path d="M28 18 Q46 20 48 30 Q42 36 32 30 Q28 26 28 18Z" fill={color} opacity=".7"/>
    {/* wing patterns */}
    <circle cx="16" cy="14" r="3.5" fill="rgba(255,255,255,.28)"/>
    <circle cx="40" cy="14" r="3.5" fill="rgba(255,255,255,.28)"/>
    <circle cx="18" cy="26" r="2.2" fill="rgba(255,255,255,.2)"/>
    <circle cx="38" cy="26" r="2.2" fill="rgba(255,255,255,.2)"/>
    {/* body */}
    <ellipse cx="28" cy="18" rx="2" ry="10" fill="#1a1a1a" opacity=".7"/>
    {/* antennae */}
    <path d="M27 8 Q22 2 18 3" stroke="#1a1a1a" strokeWidth="1" fill="none" opacity=".6"/>
    <path d="M29 8 Q34 2 38 3" stroke="#1a1a1a" strokeWidth="1" fill="none" opacity=".6"/>
    <circle cx="18" cy="3" r="1.5" fill="#1a1a1a" opacity=".6"/>
    <circle cx="38" cy="3" r="1.5" fill="#1a1a1a" opacity=".6"/>
  </svg>
);

const BirdIcon = ({ color = '#ffffff', size = 32 }) => (
  <svg width={size*1.8} height={size} viewBox="0 0 58 32" fill="none">
    {/* body */}
    <ellipse cx="29" cy="20" rx="16" ry="8" fill={color} opacity=".85"/>
    {/* tail */}
    <path d="M13 20 Q6 16 2 22 Q8 26 13 22Z" fill={color} opacity=".7"/>
    {/* left wing raised */}
    <path d="M22 18 Q16 6 8 8 Q12 16 22 20Z" fill={color} opacity=".9"/>
    {/* right wing raised */}
    <path d="M36 18 Q42 6 50 8 Q46 16 36 20Z" fill={color} opacity=".9"/>
    {/* head */}
    <circle cx="43" cy="16" r="7" fill={color} opacity=".9"/>
    {/* eye */}
    <circle cx="46" cy="14" r="1.8" fill="#333"/>
    <circle cx="46.6" cy="13.4" r=".6" fill="white"/>
    {/* beak */}
    <path d="M49 17 L55 15 L49 19Z" fill="#f97316" opacity=".9"/>
    {/* chest shading */}
    <ellipse cx="29" cy="21" rx="10" ry="5" fill="rgba(0,0,0,.08)"/>
  </svg>
);

const LadybugIcon = ({ color = '#ef4444', size = 24 }) => (
  <svg width={size} height={size*1.1} viewBox="0 0 28 30" fill="none">
    {/* body */}
    <ellipse cx="14" cy="18" rx="11" ry="11" fill={color}/>
    {/* center line */}
    <line x1="14" y1="7" x2="14" y2="29" stroke="#1a1a1a" strokeWidth="1.3" opacity=".6"/>
    {/* spots */}
    <circle cx="9" cy="14" r="2.5" fill="#1a1a1a" opacity=".7"/>
    <circle cx="19" cy="14" r="2.5" fill="#1a1a1a" opacity=".7"/>
    <circle cx="9" cy="22" r="2" fill="#1a1a1a" opacity=".7"/>
    <circle cx="19" cy="22" r="2" fill="#1a1a1a" opacity=".7"/>
    <circle cx="14" cy="25" r="1.5" fill="#1a1a1a" opacity=".5"/>
    {/* head */}
    <ellipse cx="14" cy="8" rx="7" ry="5.5" fill="#1a1a1a"/>
    {/* eyes */}
    <circle cx="11" cy="6.5" r="1.5" fill="white"/>
    <circle cx="17" cy="6.5" r="1.5" fill="white"/>
    <circle cx="11.4" cy="6.2" r=".7" fill="#1a1a1a"/>
    <circle cx="17.4" cy="6.2" r=".7" fill="#1a1a1a"/>
    {/* antennae */}
    <path d="M11 4 Q9 1 7 0" stroke="#1a1a1a" strokeWidth="1" strokeLinecap="round" fill="none"/>
    <path d="M17 4 Q19 1 21 0" stroke="#1a1a1a" strokeWidth="1" strokeLinecap="round" fill="none"/>
  </svg>
);

const GrassTuftIcon = ({ color = '#4ade80', size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
    <path d="M18 35 Q17 22 12 10 Q14 18 18 35Z" fill={color} opacity=".8"/>
    <path d="M18 35 Q19 20 26 8 Q22 18 18 35Z" fill={color} opacity=".75"/>
    <path d="M18 35 Q15 24 8 16 Q14 22 18 35Z" fill={color} opacity=".65"/>
    <path d="M18 35 Q21 26 30 20 Q24 24 18 35Z" fill={color} opacity=".65"/>
    <path d="M18 35 Q18 20 18 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity=".7" fill="none"/>
  </svg>
);

const FishIcon = ({ color = '#38bdf8', size = 32 }) => (
  <svg width={size*1.55} height={size} viewBox="0 0 50 32" fill="none">
    <path d="M4 16 Q0 8 9 10 Q4 16 9 22 Q0 24 4 16Z" fill={color} opacity=".7"/>
    <ellipse cx="27" cy="16" rx="18" ry="10" fill={color} opacity=".9"/>
    <path d="M22 10 Q29 13 22 16" stroke="rgba(255,255,255,.22)" strokeWidth="1.1" fill="none"/>
    <path d="M16 12 Q23 15 16 18" stroke="rgba(255,255,255,.16)" strokeWidth="1" fill="none"/>
    <path d="M19 7 Q25 11 19 15" fill={color} opacity=".55" stroke="none"/>
    <path d="M19 7 Q26 9 24 15 Q19 14 19 7Z" fill={color} opacity=".55"/>
    <circle cx="39" cy="13" r="3.5" fill="white" opacity=".9"/>
    <circle cx="39.5" cy="13" r="1.8" fill="#1a1a1a"/>
    <circle cx="40" cy="12.3" r=".6" fill="white"/>
    <path d="M46 15 Q49 16 46 17.5" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
  </svg>
);

const GoatIcon = ({ color = '#e2e8f0', size = 40 }) => (
  <svg width={size*1.25} height={size} viewBox="0 0 50 40" fill="none">
    <ellipse cx="22" cy="26" rx="17" ry="10" fill={color} opacity=".85"/>
    <ellipse cx="40" cy="19" rx="8" ry="7" fill={color} opacity=".9"/>
    <ellipse cx="35" cy="13" rx="3.5" ry="2.5" fill={color} opacity=".75" transform="rotate(-30 35 13)"/>
    <ellipse cx="45" cy="12" rx="3" ry="2.2" fill={color} opacity=".75" transform="rotate(20 45 12)"/>
    <path d="M38 13 Q36 7 33 6 Q35 10 38 13Z" fill={color} opacity=".65"/>
    <path d="M43 12 Q45 6 48 6 Q47 10 43 12Z" fill={color} opacity=".65"/>
    <path d="M32 23 Q35 19 39 21 Q37 25 32 25Z" fill={color} opacity=".8"/>
    <rect x="10" y="34" width="4" height="6" rx="2" fill={color} opacity=".75"/>
    <rect x="17" y="34" width="4" height="6" rx="2" fill={color} opacity=".75"/>
    <rect x="26" y="34" width="4" height="6" rx="2" fill={color} opacity=".75"/>
    <rect x="32" y="34" width="4" height="6" rx="2" fill={color} opacity=".75"/>
    <path d="M5 24 Q1 20 3 18 Q8 20 8 25Z" fill={color} opacity=".6"/>
    <circle cx="44" cy="17" r="2" fill="#1a1a1a" opacity=".75"/>
    <circle cx="44.5" cy="16.5" r=".7" fill="white"/>
    <path d="M38 25 Q37 29 35 31" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".65"/>
  </svg>
);

const MangoIcon = ({ color = '#f97316', size = 34 }) => (
  <svg width={size*.85} height={size} viewBox="0 0 29 36" fill="none">
    <path d="M14 5 Q12 1 10 0" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    <path d="M14 5 Q17 1 21 3" stroke="#4ade80" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
    <path d="M14 5 Q19 2 23 7 Q19 9 14 5Z" fill="#4ade80" opacity=".82"/>
    <path d="M14 6 C4 6 1 14 2 22 C3 30 8 35 14 35 C20 35 26 30 27 22 C28 14 24 6 14 6Z" fill={color} opacity=".9"/>
    <path d="M8 14 Q10 10 14 12" stroke="rgba(255,255,255,.38)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
    <path d="M9 21 Q11 17 14 18" stroke="rgba(255,255,255,.22)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
  </svg>
);

const AppleIcon = ({ color = '#ef4444', size = 34 }) => (
  <svg width={size*.95} height={size} viewBox="0 0 32 36" fill="none">
    <path d="M16 5 Q15 1 13 0" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    <path d="M16 5 Q20 2 22 6 Q19 7.5 16 5Z" fill="#4ade80" opacity=".85"/>
    <path d="M16 7 C6 7 2 15 2 22 C2 30 8 36 16 36 C24 36 30 30 30 22 C30 15 26 7 16 7Z" fill={color} opacity=".88"/>
    <path d="M13 8 Q16 5 19 8" stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".12"/>
    <path d="M8 15 Q10 11 14 13" stroke="rgba(255,255,255,.38)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
    <path d="M9 22 Q11 19 14 20" stroke="rgba(255,255,255,.22)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
  </svg>
);

const PineappleIcon = ({ color = '#fbbf24', size = 42 }) => (
  <svg width={size*.7} height={size} viewBox="0 0 30 46" fill="none">
    <path d="M15 14 Q13 6 11 4 Q13 9 15 14Z" fill="#4ade80" opacity=".85"/>
    <path d="M15 14 Q15 5 15 2 Q15 8 15 14Z" fill="#4ade80" opacity=".9"/>
    <path d="M15 14 Q17 6 19 4 Q17 9 15 14Z" fill="#4ade80" opacity=".85"/>
    <path d="M15 14 Q10 7 7 7 Q10 11 15 14Z" fill="#4ade80" opacity=".7"/>
    <path d="M15 14 Q20 7 23 8 Q20 12 15 14Z" fill="#4ade80" opacity=".7"/>
    <path d="M15 16 C6 16 3 22 3 28 C3 36 8 44 15 44 C22 44 27 36 27 28 C27 22 24 16 15 16Z" fill={color} opacity=".88"/>
    {[[15,22],[11,25],[19,25],[8,29],[15,29],[22,29],[11,33],[19,33],[15,37]].map(([x,y],i)=>(
      <ellipse key={i} cx={x} cy={y} rx="2.5" ry="1.8" fill="rgba(0,0,0,.13)" transform={`rotate(45 ${x} ${y})`}/>
    ))}
    <path d="M8 22 Q9 19 12 20" stroke="rgba(255,255,255,.32)" strokeWidth="2" strokeLinecap="round" fill="none"/>
  </svg>
);

const DragonflyIcon = ({ color = '#a78bfa', size = 32 }) => (
  <svg width={size*1.9} height={size} viewBox="0 0 61 32" fill="none">
    <ellipse cx="18" cy="12" rx="16" ry="6" fill="rgba(255,255,255,.48)" transform="rotate(-15 18 12)"/>
    <ellipse cx="18" cy="22" rx="13" ry="5" fill="rgba(255,255,255,.32)" transform="rotate(15 18 22)"/>
    <ellipse cx="43" cy="12" rx="16" ry="6" fill="rgba(255,255,255,.48)" transform="rotate(15 43 12)"/>
    <ellipse cx="43" cy="22" rx="13" ry="5" fill="rgba(255,255,255,.32)" transform="rotate(-15 43 22)"/>
    <ellipse cx="30.5" cy="17" rx="4" ry="13" fill={color} opacity=".85"/>
    <circle cx="30.5" cy="5" r="4.5" fill={color} opacity=".9"/>
    <circle cx="28.5" cy="4" r="2" fill="#1a1a1a" opacity=".8"/>
    <circle cx="32.5" cy="4" r="2" fill="#1a1a1a" opacity=".8"/>
    <circle cx="29" cy="3.4" r=".7" fill="white"/>
    <circle cx="33" cy="3.4" r=".7" fill="white"/>
    {[20,23.5,27].map((y,i)=>(
      <ellipse key={i} cx="30.5" cy={y} rx={3.5-i*.3} ry="1.8" stroke="rgba(0,0,0,.14)" strokeWidth=".8" fill="none"/>
    ))}
  </svg>
);

// ── Watermark scrolling text ──────────────────────────────────────────────────
const WatermarkBg = () => {
  const phrase = 'CSS RMS • CSS RMS • CSS RMS • CSS RMS • CSS RMS • ';
  const rows = [
    { top:'3%',  dur:22, dir:'normal',  delay:'0s'   },
    { top:'14%', dur:28, dir:'reverse', delay:'-8s'  },
    { top:'25%', dur:20, dir:'normal',  delay:'-14s' },
    { top:'36%', dur:26, dir:'reverse', delay:'-4s'  },
    { top:'47%', dur:24, dir:'normal',  delay:'-18s' },
    { top:'58%', dur:30, dir:'reverse', delay:'-10s' },
    { top:'69%', dur:21, dir:'normal',  delay:'-6s'  },
    { top:'80%', dur:27, dir:'reverse', delay:'-2s'  },
    { top:'91%', dur:23, dir:'normal',  delay:'-12s' },
  ];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0" style={{opacity:0.13}}>
      {rows.map((r,i)=>(
        <div key={i} style={{
          position:'absolute', top:r.top, left:0, whiteSpace:'nowrap',
          animation:`rmsMarquee ${r.dur}s linear infinite`,
          animationDirection:r.dir, animationDelay:r.delay,
          fontSize:'18px', fontWeight:900, color:'white',
          letterSpacing:'0.3em', textTransform:'uppercase',
          fontFamily:'system-ui,sans-serif',
          transform:'rotate(-9deg)', transformOrigin:'left center',
        }}>
          {phrase.repeat(5)}
        </div>
      ))}
    </div>
  );
};

// ── CSS keyframe animations ───────────────────────────────────────────────────
const RMS_ANIM_CSS = `
  @keyframes rmsFloat {
    0%,100% { transform: translateY(0) rotate(0deg); }
    33%      { transform: translateY(-14px) rotate(5deg); }
    66%      { transform: translateY(-6px) rotate(-3deg); }
  }
  @keyframes rmsSway {
    0%,100% { transform: rotate(-13deg) translateY(0); }
    50%      { transform: rotate(13deg) translateY(-10px); }
  }
  @keyframes rmsSwayAlt {
    0%,100% { transform: rotate(-9deg) scale(1); }
    50%      { transform: rotate(11deg) scale(1.05); }
  }
  @keyframes rmsBobble {
    0%,100% { transform: translateX(0) translateY(0); }
    30%      { transform: translateX(7px) translateY(-9px); }
    70%      { transform: translateX(-5px) translateY(-4px); }
  }
  @keyframes rmsDrive {
    0%,100% { transform: translateX(0) translateY(0); }
    25%      { transform: translateX(5px) translateY(-6px); }
    50%      { transform: translateX(10px) translateY(0); }
    75%      { transform: translateX(5px) translateY(-5px); }
  }
  @keyframes rmsPulse {
    0%,100% { transform: scale(1) rotate(0deg); }
    50%      { transform: scale(1.08) rotate(6deg); }
  }
  @keyframes rmsWiggle {
    0%,100% { transform: rotate(-6deg) translateX(0); }
    25%      { transform: rotate(8deg) translateX(5px); }
    75%      { transform: rotate(-4deg) translateX(-4px); }
  }
  @keyframes rmsFly {
    0%,100% { transform: translate(0,0) rotate(0deg); }
    20%      { transform: translate(10px,-14px) rotate(8deg); }
    40%      { transform: translate(-6px,-22px) rotate(-5deg); }
    60%      { transform: translate(14px,-12px) rotate(10deg); }
    80%      { transform: translate(-8px,-6px) rotate(-6deg); }
  }
  @keyframes rmsBeeWing {
    0%,100% { transform: scaleX(1) translateY(0); }
    50%      { transform: scaleX(-1) translateY(-8px); }
  }
  @keyframes rmsMarquee {
    0%   { transform: rotate(-9deg) translateX(0); }
    100% { transform: rotate(-9deg) translateX(-50%); }
  }
`;

const BG_ELS = [
  // ── Sunflowers ──
  { C:SunflowerIcon,      color:'#fbbf24', size:46, style:{top:'5%',   left:'7%'    }, anim:'rmsSway 4.5s ease-in-out infinite',           delay:'0s',   origin:'bottom center' },
  { C:SunflowerIcon,      color:'#fde047', size:32, style:{top:'58%',  right:'5%'   }, anim:'rmsSway 5.5s ease-in-out infinite reverse',    delay:'1.5s', origin:'bottom center' },
  { C:SunflowerIcon,      color:'#fbbf24', size:22, style:{top:'33%',  left:'2%'    }, anim:'rmsSway 6.5s ease-in-out infinite',            delay:'3s',   origin:'bottom center' },
  // ── Tropical leaves ──
  { C:TropicalLeafIcon,   color:'#fb923c', size:40, style:{top:'9%',   right:'9%'   }, anim:'rmsSway 5s ease-in-out infinite',             delay:'1s',   origin:'bottom center' },
  { C:TropicalLeafIcon,   color:'#f97316', size:28, style:{bottom:'18%',left:'9%'   }, anim:'rmsSway 6.5s ease-in-out infinite reverse',   delay:'2s',   origin:'bottom center' },
  { C:TropicalLeafIcon,   color:'#fde047', size:24, style:{top:'47%',  right:'2%'   }, anim:'rmsSwayAlt 5.5s ease-in-out infinite',        delay:'4s',   origin:'bottom center' },
  // ── Flowers ──
  { C:FlowerIcon,         color:'#f87171', size:36, style:{top:'21%',  left:'55%'   }, anim:'rmsFloat 5.5s ease-in-out infinite',          delay:'0.5s' },
  { C:FlowerIcon,         color:'#ef4444', size:26, style:{bottom:'32%',right:'14%' }, anim:'rmsPulse 4.5s ease-in-out infinite',          delay:'2.5s' },
  { C:FlowerIcon,         color:'#fca5a5', size:20, style:{top:'73%',  left:'54%'   }, anim:'rmsFloat 7s ease-in-out infinite reverse',    delay:'1s'   },
  { C:FlowerIcon,         color:'#fb7185', size:18, style:{top:'44%',  left:'44%'   }, anim:'rmsPulse 6s ease-in-out infinite',            delay:'3.5s' },
  // ── Palm leaves ──
  { C:PalmLeafIcon,       color:'#ffffff', size:38, style:{top:'28%',  left:'62%'   }, anim:'rmsSway 7s ease-in-out infinite',             delay:'3.5s', origin:'bottom center' },
  { C:PalmLeafIcon,       color:'#fde047', size:28, style:{bottom:'26%',left:'36%'  }, anim:'rmsSwayAlt 6s ease-in-out infinite reverse',  delay:'1.5s', origin:'bottom center' },
  // ── Grass tufts ──
  { C:GrassTuftIcon,      color:'#86efac', size:30, style:{bottom:'8%', left:'18%'  }, anim:'rmsSway 4s ease-in-out infinite',             delay:'0.8s', origin:'bottom center' },
  { C:GrassTuftIcon,      color:'#4ade80', size:24, style:{bottom:'6%', left:'48%'  }, anim:'rmsSway 5s ease-in-out infinite reverse',     delay:'2.2s', origin:'bottom center' },
  { C:GrassTuftIcon,      color:'#86efac', size:20, style:{bottom:'5%', right:'22%' }, anim:'rmsSwayAlt 4.5s ease-in-out infinite',        delay:'1.3s', origin:'bottom center' },
  // ── Bees ──
  { C:BeeIcon,            color:'#fbbf24', size:28, style:{top:'16%',  left:'42%'   }, anim:'rmsFly 7s ease-in-out infinite',              delay:'0.5s' },
  { C:BeeIcon,            color:'#fde047', size:22, style:{top:'65%',  left:'22%'   }, anim:'rmsFly 9s ease-in-out infinite reverse',      delay:'3s'   },
  // ── Butterflies ──
  { C:ButterflyIcon,      color:'#f87171', size:30, style:{top:'40%',  left:'70%'   }, anim:'rmsFly 8s ease-in-out infinite',              delay:'2s'   },
  { C:ButterflyIcon,      color:'#fbbf24', size:24, style:{top:'12%',  left:'32%'   }, anim:'rmsFly 6s ease-in-out infinite reverse',      delay:'4.5s' },
  { C:ButterflyIcon,      color:'#ffffff', size:20, style:{bottom:'45%',left:'58%'  }, anim:'rmsFly 10s ease-in-out infinite',             delay:'1s'   },
  // ── Birds ──
  { C:BirdIcon,           color:'#ffffff', size:28, style:{top:'3%',   left:'40%'   }, anim:'rmsFly 12s ease-in-out infinite',             delay:'0s'   },
  { C:BirdIcon,           color:'#fde047', size:20, style:{top:'82%',  right:'28%'  }, anim:'rmsFloat 8s ease-in-out infinite reverse',   delay:'5s'   },
  // ── Ladybugs ──
  { C:LadybugIcon,        color:'#ef4444', size:22, style:{top:'55%',  left:'46%'   }, anim:'rmsBobble 5s ease-in-out infinite',           delay:'1.5s' },
  { C:LadybugIcon,        color:'#f87171', size:16, style:{top:'78%',  right:'36%'  }, anim:'rmsWiggle 4s ease-in-out infinite reverse',   delay:'3s'   },
  // ── Tractors ──
  { C:DetailedTractorIcon,color:'#fde047', size:44, style:{bottom:'12%',left:'2%'   }, anim:'rmsDrive 5s ease-in-out infinite',            delay:'0s'   },
  { C:DetailedTractorIcon,color:'#ffffff', size:30, style:{bottom:'40%',right:'1%'  }, anim:'rmsDrive 7s ease-in-out infinite reverse',    delay:'3.5s' },
  { C:DetailedTractorIcon,color:'#fb923c', size:24, style:{top:'72%',  left:'28%'   }, anim:'rmsBobble 6s ease-in-out infinite',           delay:'2s'   },
  { C:DetailedTractorIcon,color:'#86efac', size:36, style:{top:'52%',  right:'3%'   }, anim:'rmsDrive 8s ease-in-out infinite',            delay:'5s'   },
  // ── Fish ──
  { C:FishIcon,           color:'#38bdf8', size:34, style:{top:'20%',  right:'18%'  }, anim:'rmsFly 9s ease-in-out infinite',              delay:'1s'   },
  { C:FishIcon,           color:'#fbbf24', size:26, style:{top:'60%',  left:'36%'   }, anim:'rmsFly 7s ease-in-out infinite reverse',      delay:'3.5s' },
  { C:FishIcon,           color:'#f87171', size:20, style:{bottom:'22%',right:'30%' }, anim:'rmsBobble 6s ease-in-out infinite',           delay:'6s'   },
  // ── Goats ──
  { C:GoatIcon,           color:'#e2e8f0', size:38, style:{bottom:'16%',left:'32%'  }, anim:'rmsDrive 6s ease-in-out infinite',            delay:'2s'   },
  { C:GoatIcon,           color:'#fde047', size:28, style:{bottom:'28%',right:'8%'  }, anim:'rmsBobble 5.5s ease-in-out infinite reverse', delay:'4s'   },
  // ── Fruits ──
  { C:MangoIcon,          color:'#f97316', size:36, style:{top:'37%',  right:'6%'   }, anim:'rmsFloat 5s ease-in-out infinite',            delay:'1.5s' },
  { C:MangoIcon,          color:'#fbbf24', size:26, style:{top:'8%',   left:'20%'   }, anim:'rmsPulse 6s ease-in-out infinite reverse',    delay:'3s'   },
  { C:AppleIcon,          color:'#ef4444', size:34, style:{bottom:'36%',left:'16%'  }, anim:'rmsFloat 7s ease-in-out infinite',            delay:'0.5s' },
  { C:AppleIcon,          color:'#fb923c', size:22, style:{top:'63%',  right:'22%'  }, anim:'rmsPulse 5s ease-in-out infinite',            delay:'4.5s' },
  { C:PineappleIcon,      color:'#fbbf24', size:44, style:{bottom:'6%', right:'6%'  }, anim:'rmsSway 6s ease-in-out infinite',             delay:'1s',   origin:'bottom center' },
  { C:PineappleIcon,      color:'#fb923c', size:30, style:{top:'18%',  left:'72%'   }, anim:'rmsFloat 8s ease-in-out infinite reverse',    delay:'2.5s' },
  // ── Dragonflies ──
  { C:DragonflyIcon,      color:'#a78bfa', size:28, style:{top:'30%',  left:'8%'    }, anim:'rmsFly 8s ease-in-out infinite',              delay:'1s'   },
  { C:DragonflyIcon,      color:'#38bdf8', size:22, style:{bottom:'50%',right:'16%' }, anim:'rmsFly 11s ease-in-out infinite reverse',     delay:'5s'   },
];

const AnimBg = ({ mobile = false }) => (
  <div className={`absolute inset-0 pointer-events-none overflow-hidden ${mobile ? 'lg:hidden z-0' : 'z-[1]'}`}>
    {!mobile && <WatermarkBg />}
    {BG_ELS.map(({ C, color, size, style, anim, delay, origin }, i) => (
      <div key={i} className="absolute" style={{
        ...style,
        animation: anim,
        animationDelay: delay,
        transformOrigin: origin || 'center',
        opacity: mobile ? 0.12 : 0.74,
        filter: mobile ? 'none' : 'drop-shadow(0 3px 8px rgba(0,0,0,0.22))',
      }}>
        <C color={color} size={size} />
      </div>
    ))}
  </div>
);
// ─────────────────────────────────────────────────────────────────────────────

// ── Typewriter headline — types line1 then line2, pauses, deletes both, repeats ──
const TypewriterHeadline = ({ line1, line2 }) => {
  const [text1, setText1] = useState('');
  const [text2, setText2] = useState('');
  const [phase, setPhase] = useState('typing1');

  useEffect(() => {
    const TYPE_SPEED = 85;
    const DELETE_SPEED = 45;
    const PAUSE_FULL = 2200;
    const PAUSE_EMPTY = 500;
    let timer;

    if (phase === 'typing1') {
      timer = text1.length < line1.length
        ? setTimeout(() => setText1(line1.slice(0, text1.length + 1)), TYPE_SPEED)
        : setTimeout(() => setPhase('typing2'), 200);
    } else if (phase === 'typing2') {
      timer = text2.length < line2.length
        ? setTimeout(() => setText2(line2.slice(0, text2.length + 1)), TYPE_SPEED)
        : setTimeout(() => setPhase('deleting2'), PAUSE_FULL);
    } else if (phase === 'deleting2') {
      timer = text2.length > 0
        ? setTimeout(() => setText2(text2.slice(0, -1)), DELETE_SPEED)
        : setTimeout(() => setPhase('deleting1'), 150);
    } else if (phase === 'deleting1') {
      timer = text1.length > 0
        ? setTimeout(() => setText1(text1.slice(0, -1)), DELETE_SPEED)
        : setTimeout(() => setPhase('typing1'), PAUSE_EMPTY);
    }
    return () => clearTimeout(timer);
  }, [phase, text1, text2, line1, line2]);

  const cursorOnLine1 = phase === 'typing1' || phase === 'deleting1';
  const cursorOnLine2 = phase === 'typing2' || phase === 'deleting2';

  return (
    <>
      <h1 className="text-[56px] font-black tracking-[-0.02em] leading-[0.9] text-white mb-1 min-h-[56px]">
        {text1}
        {cursorOnLine1 && <span className="inline-block w-[4px] h-[44px] bg-white/80 ml-1 align-middle animate-pulse" />}
      </h1>
      <h2 className="text-[34px] italic font-extrabold text-white/65 leading-none mb-4 min-h-[34px]">
        {text2}
        {cursorOnLine2 && <span className="inline-block w-[3px] h-[28px] bg-white/60 ml-1 align-middle animate-pulse" />}
      </h2>
    </>
  );
};

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

const Login = () => {
  const [selectedDept, setSelectedDept] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [departments, setDepartments] = useState([]);
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileRequiredDepts, setTurnstileRequiredDepts] = useState([]);
  const [turnstileGloballyEnabled, setTurnstileGloballyEnabled] = useState(true);
  const turnstileRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [showForgotCode, setShowForgotCode] = useState(false);
  const [ictPhone, setIctPhone] = useState('');
  const [deptDropOpen, setDeptDropOpen] = useState(false);
  const [deptSearch, setDeptSearch] = useState('');
  const deptSearchRef = useRef(null);
  const [deptActivated, setDeptActivated] = useState(null); // null=unknown, true=activated(PASSWORD), false=first-time(ACCESS CODE)
  // Biometric state
  const [bioReady, setBioReady] = useState(false);   // device supports biometric
  const [bioDepts, setBioDepts] = useState([]);       // depts with saved biometric
  const [bioLoading, setBioLoading] = useState(false);
  const [showBioEnroll, setShowBioEnroll] = useState(null); // dept name to enroll
  const [pendingBioCode, setPendingBioCode] = useState(''); // code to store after login
  // First-time activation flow
  const [activation, setActivation] = useState(null); // { token, deptName } when requiresActivation
  const [actName, setActName] = useState('');
  const [actTitle, setActTitle] = useState('');
  const [actEmail, setActEmail] = useState('');
  const [actPassword, setActPassword] = useState('');
  const [actConfirm, setActConfirm] = useState('');
  const [actShowPwd, setActShowPwd] = useState(false);
  const [actSubmitting, setActSubmitting] = useState(false);
  const [actError, setActError] = useState('');
  const deptDropRef = useRef(null);
  const { deptLogin, loginWithData } = useAuth();

  const mainDepts = departments.filter(d => d.type !== 'Sub-Account' && !d.isSubAccount);

  useEffect(() => {
    if (deptDropOpen) {
      setTimeout(() => deptSearchRef.current?.focus(), 50);
    } else {
      setDeptSearch('');
    }
  }, [deptDropOpen]);

  // Check biometric availability on mount (native only)
  useEffect(() => {
    if (!isNative()) return;
    bioAvailable().then(ok => {
      if (ok) {
        setBioReady(true);
        setBioDepts(getSavedBioDepts());
      }
    });
  }, []);

  useEffect(() => {
    getDepartments().then(setDepartments);
    fetch('/api/public/support-phone').then(r=>r.json()).then(d=>{if(d?.value) setIctPhone(d.value);}).catch(()=>{});
    if (TURNSTILE_SITE_KEY) {
      fetch('/api/public/turnstile-config').then(r=>r.json()).then(d=>{
        if (Array.isArray(d?.requiredDepts)) setTurnstileRequiredDepts(d.requiredDepts.map(n => n.toLowerCase()));
        // TURNSTILE_ENABLED=false in Railway env disables widget globally
        if (d?.globallyEnabled === false) setTurnstileGloballyEnabled(false);
      }).catch(()=>{});
    }
    const handleOutside = e => {
      if (deptDropRef.current && !deptDropRef.current.contains(e.target)) setDeptDropOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => { document.removeEventListener('mousedown', handleOutside); };
  }, []);

  // Does the currently selected department require Turnstile?
  // Also gated by TURNSTILE_ENABLED env var via globallyEnabled flag from server.
  const turnstileNeeded = !!(TURNSTILE_SITE_KEY && turnstileGloballyEnabled && selectedDept && turnstileRequiredDepts.includes(selectedDept.toLowerCase()));

  // Render Turnstile widget once the script is loaded
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const render = () => {
      if (!window.turnstile || !turnstileRef.current || widgetIdRef.current != null) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    };
    if (window.turnstile) { render(); return; }
    const iv = setInterval(() => { if (window.turnstile) { clearInterval(iv); render(); } }, 100);
    return () => clearInterval(iv);
  }, []);

  const selectDept = async (name) => {
    setSelectedDept(name);
    setDeptActivated(null);
    setTurnstileToken('');
    if (TURNSTILE_SITE_KEY && widgetIdRef.current != null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
    if (!name || name === 'Super Admin') {
      setDeptActivated(name === 'Super Admin' ? true : null);
      return;
    }
    try {
      const res = await fetch(`/api/departments/login-status?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        setDeptActivated(data.activated);
      }
    } catch (_) { /* leave as null */ }
  };

  const resetTurnstile = () => {
    if (TURNSTILE_SITE_KEY && widgetIdRef.current != null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
    setTurnstileToken('');
  };

  const handleLogin = async e => {
    e.preventDefault();
    setError('');
    if (turnstileNeeded && !turnstileToken) {
      setError('Please complete the human verification check below.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (!selectedDept) throw new Error("Please select a department");
      await deptLogin(selectedDept, accessCode, mfaCode, turnstileToken);
      // Offer biometric enrollment on native devices if not already set up
      if (bioReady && !hasBioDept(selectedDept)) {
        setPendingBioCode(accessCode);
        setShowBioEnroll(selectedDept);
      }
    } catch (err) {
      if (err.message === 'REQUIRES_ACTIVATION') {
        setActivation({ token: err.activationToken, deptName: err.activationDeptName, isSubAccount: err.isSubAccount, headName: err.headName || '', headTitle: err.headTitle || '', headEmail: err.headEmail || '' });
        setIsSubmitting(false);
        return;
      }
      resetTurnstile();
      const s = err.response?.status;
      setError(
        s === 401 ? (err.response?.data?.error || 'Incorrect password. Please try again.') :
        s === 429 ? 'Too many attempts. Please wait a moment and try again.' :
        s >= 500  ? 'Server temporarily unavailable. Please retry in a few seconds.' :
        (!navigator.onLine || err.code === 'ERR_NETWORK') ? 'No internet connection. Check your network.' :
        (err.response?.data?.error || err.message || 'Authentication failed.')
      );
      setIsSubmitting(false);
    }
  };

  const handleBioLogin = async () => {
    if (!selectedDept) { setError('Please select your department first.'); return; }
    setBioLoading(true);
    setError('');
    try {
      const code = await loginWithBiometric(selectedDept);
      await deptLogin(selectedDept, code, '', '');
    } catch (err) {
      if (err?.message?.includes('cancel') || err?.message?.includes('Cancel') || err?.code === 'BIOMETRIC_DISMISSED') {
        // user cancelled — do nothing
      } else {
        setError('Biometric login failed. Please use your password.');
      }
    } finally {
      setBioLoading(false);
    }
  };

  const handleBioEnrollYes = async () => {
    try {
      await enrollBiometric(showBioEnroll, pendingBioCode);
      setBioDepts(getSavedBioDepts());
      toast.success('Fingerprint login enabled!', { icon: '🔒' });
    } catch {
      toast.error('Could not enable fingerprint login.');
    } finally {
      setShowBioEnroll(null);
      setPendingBioCode('');
    }
  };

  const handleCancelActivation = () => {
    setActivation(null);
    setActName(''); setActTitle(''); setActEmail('');
    setActPassword(''); setActConfirm(''); setActError('');
    setSelectedDept(''); setAccessCode(''); setMfaCode('');
    setDeptActivated(null);
  };

  const handleActivate = async e => {
    e.preventDefault();
    setActError('');
    if (actPassword.length < 6) { setActError('Password must be at least 6 characters.'); return; }
    if (actPassword !== actConfirm) { setActError('Passwords do not match.'); return; }
    setActSubmitting(true);
    try {
      const res = await fetch('/api/departments/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          activationToken: activation.token,
          headName:  activation.headName  || '',
          headTitle: activation.headTitle || '',
          headEmail: activation.headEmail || '',
          newPassword: actPassword,
          confirmPassword: actConfirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setActError(data.error || 'Activation failed.'); setActSubmitting(false); return; }
      // Activate endpoint already set the auth cookie and returned userData — use it directly.
      // Calling deptLogin here would trigger Turnstile verification and fail with 400.
      await loginWithData(data.user, selectedDept, actPassword, null);
    } catch (err) {
      setActError(err.message || 'Activation failed. Please try again.');
      setActSubmitting(false);
    }
  };

  return (
    <>
    <style>{RMS_ANIM_CSS}</style>
    <div className="min-h-screen bg-background flex flex-col lg:flex-row relative overflow-hidden">
      <AnimBg mobile />

      {/* ── Left Branding Panel ── */}
      <div className="hidden lg:flex lg:w-[46%] bg-gradient-to-br from-[#0a1a0c] via-[#1a3320] to-[#0a1a0c] text-white relative overflow-hidden flex-col justify-between p-10">
        <div className="absolute inset-0 bg-black/20 z-0" />
        <AnimBg />
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/4 rounded-full -translate-y-1/3 translate-x-1/3 blur-sm z-[2]" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/4 rounded-full translate-y-1/3 -translate-x-1/3 z-[2]" />

        {/* ── Branding Card ── */}
        <div className="relative z-10 border border-white/18 bg-white/6 backdrop-blur-md rounded-[36px] px-9 py-9 flex flex-col items-center text-center my-auto">

          {/* Logo row */}
          <div className="flex flex-col items-center gap-3 w-full mb-5">
            <div className="w-[66px] h-[66px] rounded-2xl overflow-hidden ring-2 ring-white/15 shadow-xl shrink-0 bg-white/10 flex items-center justify-center">
              <img src="/CSS_Group.png" alt="CSS Group" className="w-full h-full object-contain p-1"/>
            </div>
            <div className="text-center leading-tight">
              <p className="text-[9.5px] font-black uppercase tracking-[0.32em] text-white/38">CSS Group of</p>
              <p className="text-[17px] font-black uppercase tracking-[0.16em] text-white">Companies</p>
              <div className="mt-1 w-8 h-[2px] bg-white/20 rounded-full mx-auto"/>
            </div>
          </div>

          <div className="w-full h-px bg-white/10 mb-6"/>

          {/* Badge */}
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-white/10 border border-white/14 text-[9px] font-black uppercase tracking-[0.38em] text-white/50 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40 inline-block"/>
            Enterprise Portal
          </span>

          {/* Headline — animated typewriter effect */}
          <TypewriterHeadline line1="Requisition" line2="Management System" />

          {/* Divider with RMS label */}
          <div className="flex items-center gap-3 w-full mb-4">
            <div className="flex-1 h-px bg-white/10"/>
            <span className="text-[9px] font-black text-white/28 uppercase tracking-[0.4em]">RMS</span>
            <div className="flex-1 h-px bg-white/10"/>
          </div>

          {/* Tagline */}
          <p className="text-[11.5px] text-white/45 leading-relaxed max-w-[200px] font-medium mb-6">
            Streamlined enterprise workflow for requisitions, memos &amp; procurement across all CSS Group departments.
          </p>

          <div className="w-full h-px bg-white/10 mb-5"/>

          {/* Feature rows */}
          <div className="w-full flex flex-col gap-2">
            {[
              { text:'End-to-end approval tracking',  bg:'#ffffff',  border:'rgba(255,255,255,0.9)', textColor:'#166534', iconStroke:'#166534', iconBg:'rgba(22,101,52,0.12)', iconBorder:'rgba(22,101,52,0.25)' },
              { text:'Offline draft capability',       bg:'#f97316',  border:'#fb923c',              textColor:'#ffffff', iconStroke:'#ffffff', iconBg:'rgba(255,255,255,0.25)', iconBorder:'rgba(255,255,255,0.35)' },
              { text:'Multi-department oversight',     bg:'#14532d',  border:'#166534',              textColor:'#ffffff', iconStroke:'#ffffff', iconBg:'rgba(255,255,255,0.15)', iconBorder:'rgba(255,255,255,0.3)' },
            ].map(({ text, bg, border, textColor, iconStroke, iconBg, iconBorder }, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{background:bg, border:`1px solid ${border}`}}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{background:iconBg, border:`1px solid ${iconBorder}`}}>
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke={iconStroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="text-[11.5px] font-semibold tracking-wide text-left" style={{color:textColor}}>{text}</span>
              </div>
            ))}
          </div>

        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center gap-3 text-[9px] text-white/35 uppercase tracking-widest">
          <span>RMS</span>
          <span className="w-1 h-1 rounded-full bg-white/25 inline-block"/>
          <span className="italic">ISO coming soon</span>
        </div>
      </div>

      {/* ── Right Form Panel ── */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-10 relative z-10 bg-white lg:bg-gradient-to-br lg:from-slate-50 lg:to-white">
        <div className="w-full max-w-lg">

          {/* Form card */}
          <div className="bg-white rounded-3xl shadow-2xl shadow-black/8 border border-border/50 overflow-hidden">

            {/* Card top accent bar */}
            <div className="h-1.5 bg-gradient-to-r from-primary via-primary/70 to-primary/30"/>

            <div className="p-8 lg:p-10">

              {/* Mobile logo banner */}
              <div className="lg:hidden -mx-10 -mt-10 mb-8 bg-primary px-8 py-5 flex items-center gap-4 border-b border-white/10">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/15 p-0.5 shrink-0">
                  <img src="/CSS_Favicon.png" alt="Logo" className="w-full h-full object-contain"/>
                </div>
                <div>
                  <p className="text-[10px] text-white/65 uppercase tracking-[0.3em] font-bold leading-none">CSS Group</p>
                  <p className="text-base font-black text-white tracking-[0.1em] italic uppercase mt-0.5">RMS Portal</p>
                </div>
              </div>

              {/* Header */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/8 border border-primary/12 mb-4">
                  <Lock size={22} className="text-primary"/>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground leading-tight">Sign In to Dashboard</h2>
                <p className="text-sm text-muted-foreground mt-1.5 font-medium">Welcome back — authenticate to access the RMS portal</p>
              </div>

              {error && (
                <div className="bg-destructive/8 border border-destructive/20 text-destructive text-sm px-4 py-3.5 rounded-2xl mb-6 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-destructive animate-pulse mt-1 shrink-0"/>
                  <span className="leading-snug">{error}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">

                {/* Dept selector — single dropdown; access code determines head vs sub-account */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">Department</label>
                  <div ref={deptDropRef} className="relative">
                    <button type="button" disabled={isSubmitting}
                      onClick={() => setDeptDropOpen(v => !v)}
                      className={`w-full flex items-center gap-2.5 px-4 py-3.5 rounded-2xl border text-sm transition-all disabled:opacity-50 ${selectedDept ? 'border-primary bg-primary/5 text-foreground font-semibold' : 'border-border/70 bg-white/80 text-muted-foreground hover:border-primary/40 hover:bg-primary/2'}`}>
                      <Building2 size={16} className={selectedDept ? 'text-primary shrink-0' : 'text-muted-foreground/40 shrink-0'}/>
                      <span className="flex-1 text-left truncate text-[13px]">{selectedDept || 'Select your department…'}</span>
                      {selectedDept
                        ? <X size={13} className="text-muted-foreground hover:text-red-500 shrink-0" onClick={e => { e.stopPropagation(); selectDept(''); }}/>
                        : <ChevronDown size={14} className={`shrink-0 transition-transform ${deptDropOpen ? 'rotate-180' : ''}`}/>}
                    </button>
                    {deptDropOpen && mainDepts.length > 0 && (() => {
                      const filtered = mainDepts.filter(d => d.name.toLowerCase().includes(deptSearch.toLowerCase()));
                      return (
                        <div className="absolute top-full left-0 w-full mt-1.5 z-50 bg-white border border-border/60 rounded-2xl shadow-2xl overflow-hidden">
                          {/* Search box */}
                          <div className="px-3 pt-3 pb-2 border-b border-border/30">
                            <div className="relative">
                              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                              </svg>
                              <input
                                ref={deptSearchRef}
                                type="text"
                                value={deptSearch}
                                onChange={e => setDeptSearch(e.target.value)}
                                placeholder="Search departments…"
                                className="w-full pl-8 pr-3 py-2 text-[12px] border border-border/50 rounded-xl bg-muted/30 outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10 transition-all placeholder-muted-foreground/40"
                                onKeyDown={e => {
                                  if (e.key === 'Escape') { setDeptDropOpen(false); }
                                  if (e.key === 'Enter' && filtered.length === 1) { selectDept(filtered[0].name); setDeptDropOpen(false); }
                                }}
                              />
                              {deptSearch && (
                                <button type="button" onClick={() => setDeptSearch('')}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors">
                                  <X size={11}/>
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Results list */}
                          <div className="max-h-48 overflow-y-auto">
                            {filtered.length > 0 ? filtered.map(d => (
                              <button key={d.id} type="button"
                                onClick={() => { selectDept(d.name); setDeptDropOpen(false); }}
                                className={`w-full text-left px-4 py-3 text-sm flex items-center gap-2.5 hover:bg-primary/5 transition-colors ${selectedDept === d.name ? 'bg-primary/8 text-primary font-semibold' : 'text-foreground'}`}>
                                <Building2 size={13} className="text-muted-foreground/40 shrink-0"/>
                                <span className="truncate">{d.name}</span>
                              </button>
                            )) : (
                              <div className="px-4 py-6 text-center text-xs text-muted-foreground/50 italic">
                                No departments match "<span className="font-semibold not-italic text-muted-foreground">{deptSearch}</span>"
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Access code */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">
                    {!selectedDept || deptActivated === null
                      ? 'Password / Access Code'
                      : deptActivated
                        ? 'Password'
                        : 'Access Code'}
                  </label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-primary transition-colors" size={17}/>
                    <input
                      type={showAccessCode ? "text" : "password"}
                      value={accessCode}
                      onChange={e=>setAccessCode(e.target.value)}
                      disabled={isSubmitting}
                      className="w-full bg-white border border-border/70 rounded-2xl pl-11 pr-13 py-3.5 text-sm text-foreground placeholder-muted-foreground/50 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 font-mono tracking-widest"
                      placeholder="••••••••"
                      required
                    />
                    <button type="button" onClick={()=>setShowAccessCode(!showAccessCode)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-primary transition-colors">
                      {showAccessCode ? <EyeOff size={17}/> : <Eye size={17}/>}
                    </button>
                  </div>
                </div>

                {selectedDept === 'Super Admin' && (
                  <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                    <label className="text-xs font-bold text-primary uppercase tracking-[0.12em] flex items-center justify-between">
                      <span>MFA Security PIN</span>
                      <span className="text-[9px] lowercase opacity-60 font-medium">Required for Admin</span>
                    </label>
                    <div className="relative group">
                      <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/40 group-focus-within:text-primary transition-colors" size={17}/>
                      <input type="text" maxLength={6} value={mfaCode}
                        onChange={e=>setMfaCode(e.target.value.replace(/\D/g,''))}
                        disabled={isSubmitting}
                        className="w-full bg-primary/5 border border-primary/20 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-foreground placeholder-primary/30 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 font-mono tracking-[0.5em] text-center"
                        placeholder="000000" required/>
                    </div>
                  </div>
                )}

                {TURNSTILE_SITE_KEY && (
                  <div className={turnstileNeeded ? 'flex justify-center' : 'hidden'}>
                    <div ref={turnstileRef} />
                  </div>
                )}

                <div className="pt-1 space-y-3">
                  <button type="submit" disabled={isSubmitting || (turnstileNeeded && !turnstileToken)}
                    className="w-full bg-primary hover:bg-primary/90 active:bg-primary/95 text-primary-foreground font-bold py-4 px-5 rounded-2xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-3 active:scale-[0.985] disabled:opacity-50 text-base">
                    {isSubmitting
                      ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/><span>Authenticating…</span></>
                      : <><span>Enter RMS Portal</span><ArrowRight size={18}/></>}
                  </button>

                  {/* Biometric login button — only on native device with saved credentials */}
                  {bioReady && selectedDept && bioDepts.includes(selectedDept) && (
                    <button
                      type="button"
                      onClick={handleBioLogin}
                      disabled={bioLoading || isSubmitting}
                      className="w-full border-2 border-primary/30 hover:border-primary/60 bg-primary/5 hover:bg-primary/10 text-primary font-bold py-3.5 px-5 rounded-2xl transition-all flex items-center justify-center gap-3 active:scale-[0.985] disabled:opacity-50 text-sm">
                      {bioLoading
                        ? <><div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"/><span>Verifying…</span></>
                        : <><Fingerprint size={20}/><span>Login with Fingerprint</span></>}
                    </button>
                  )}

                  {/* Show fingerprint hint when dept selected but not enrolled */}
                  {bioReady && selectedDept && !bioDepts.includes(selectedDept) && (
                    <p className="text-center text-[10px] text-muted-foreground/50 flex items-center justify-center gap-1.5">
                      <Fingerprint size={11}/>
                      Log in with password once to enable fingerprint
                    </p>
                  )}
                </div>

                <div className="text-center">
                  <button type="button" onClick={()=>setShowForgotCode(true)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5 group py-1">
                    <HelpCircle size={13} className="group-hover:scale-110 transition-transform"/>
                    Forgot your password?
                  </button>
                </div>

              </form>

              <div className="mt-8 pt-6 border-t border-border/30 text-center">
                <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-[0.22em]">© 2026 CSS Group of Companies</p>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── First-Time Activation Modal ── */}
      {activation && (
        <div className="fixed inset-0 z-[300] flex items-start sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 relative my-4 mx-auto">
            {/* Top accent */}
            <div className="h-1.5 bg-gradient-to-r from-primary via-primary/70 to-primary/30 rounded-t-3xl"/>
            {/* Close / cancel button */}
            <button
              type="button"
              onClick={handleCancelActivation}
              disabled={actSubmitting}
              title="Cancel and go back to login"
              className="absolute top-4 right-4 p-1.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all disabled:opacity-40"
            >
              <X size={17}/>
            </button>
            <div className="p-5 sm:p-8">
              {/* Header */}
              <div className="flex flex-col items-center text-center mb-7">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <CheckCircle2 size={26} className="text-primary"/>
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  {activation.isSubAccount ? 'Create Your Password' : 'Activate Your Account'}
                </h2>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-[280px]">
                  Welcome, <span className="font-semibold text-primary">{activation.deptName}</span>!{' '}
                  {activation.isSubAccount
                    ? 'You\'re logging in for the first time. Create a personal password to replace your access code.'
                    : 'Set up your personal details and create a new password to activate your dashboard.'}
                </p>
              </div>

              {actError && (
                <div className="bg-destructive/8 border border-destructive/20 text-destructive text-xs px-4 py-3 rounded-2xl mb-5 flex items-start gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-destructive animate-pulse mt-0.5 shrink-0"/>
                  <span className="leading-snug">{actError}</span>
                </div>
              )}

              <form onSubmit={handleActivate} className="space-y-4">
                {/* Name / Title / Email — dept heads only, always read-only */}
                {!activation.isSubAccount && (() => {
                  const profileIncomplete = !activation.headName?.trim() || !activation.headEmail?.trim();
                  return (
                    <>
                      {profileIncomplete && (
                        <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                          <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-700 leading-snug font-medium">
                            Your profile has not been set up yet. Please contact your <strong>Super Admin</strong> to fill in your name and email before you can activate your account.
                          </p>
                        </div>
                      )}
                      {(() => {
                        const nameParts = (activation.headName || '').trim().split(/\s+/);
                        return [
                          { label: 'Surname',          value: nameParts[0] || '' },
                          { label: 'First Name',       value: nameParts[1] || '' },
                          { label: 'Other Name',       value: nameParts.slice(2).join(' ') || '' },
                          { label: 'Position / Title', value: activation.headTitle },
                          { label: 'Email Address',    value: activation.headEmail },
                        ];
                      })().map(({ label, value }) => (
                        <div key={label} className="space-y-1.5">
                          <label className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">{label}</label>
                          <div className="w-full bg-muted/40 border border-border/50 rounded-2xl px-4 py-3 text-sm flex items-center gap-2">
                            {value
                              ? <span className="text-foreground font-medium">{value}</span>
                              : <span className="text-muted-foreground/50 italic">Not set</span>
                            }
                            <span className="ml-auto text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">Read only</span>
                          </div>
                        </div>
                      ))}
                      {profileIncomplete && (
                        <div className="pt-1">
                          <button type="button" onClick={handleCancelActivation}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-border/50 text-muted-foreground text-xs font-bold uppercase tracking-widest hover:bg-muted/60 transition-all">
                            <X size={13} /> Go back to login
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Password row — only shown when profile is complete */}
                {(activation.isSubAccount || (activation.headName?.trim() && activation.headEmail?.trim())) && (<>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">
                      New Password <span className="text-destructive">*</span>
                    </label>
                    <div className="relative group">
                      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-primary transition-colors"/>
                      <input
                        type={actShowPwd ? 'text' : 'password'}
                        value={actPassword}
                        onChange={e => setActPassword(e.target.value)}
                        disabled={actSubmitting}
                        placeholder="Min 6 chars"
                        className="w-full bg-white border border-border/70 rounded-2xl pl-8 pr-9 py-3 text-sm text-foreground placeholder-muted-foreground/40 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 font-mono tracking-widest"
                        required
                        minLength={6}
                      />
                      <button type="button" onClick={() => setActShowPwd(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-primary transition-colors">
                        {actShowPwd ? <EyeOff size={14}/> : <Eye size={14}/>}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">
                      Confirm <span className="text-destructive">*</span>
                    </label>
                    <div className="relative group">
                      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-primary transition-colors"/>
                      <input
                        type={actShowPwd ? 'text' : 'password'}
                        value={actConfirm}
                        onChange={e => setActConfirm(e.target.value)}
                        disabled={actSubmitting}
                        placeholder="Repeat"
                        className={`w-full bg-white border rounded-2xl pl-8 pr-3 py-3 text-sm text-foreground placeholder-muted-foreground/40 outline-none focus:ring-2 transition-all disabled:opacity-50 font-mono tracking-widest ${actConfirm && actPassword !== actConfirm ? 'border-destructive/50 focus:border-destructive focus:ring-destructive/10' : 'border-border/70 focus:border-primary focus:ring-primary/10'}`}
                        required
                      />
                    </div>
                  </div>
                </div>
                {actPassword && actPassword.length < 6 && (
                  <p className="text-[10px] text-amber-500 -mt-1">Password must be at least 6 characters.</p>
                )}
                {actConfirm && actPassword !== actConfirm && (
                  <p className="text-[10px] text-destructive -mt-1">Passwords do not match.</p>
                )}

                <div className="pt-2 space-y-3">
                  <button type="submit"
                    disabled={actSubmitting || actPassword.length < 6 || actPassword !== actConfirm}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3.5 px-5 rounded-2xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2.5 disabled:opacity-50 text-sm">
                    {actSubmitting
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/><span>{activation.isSubAccount ? 'Setting up…' : 'Activating…'}</span></>
                      : <><CheckCircle2 size={16}/><span>{activation.isSubAccount ? 'Set Password & Enter Dashboard' : 'Activate & Enter Dashboard'}</span></>}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelActivation}
                    disabled={actSubmitting}
                    className="w-full border border-border/60 hover:border-destructive/40 hover:bg-destructive/5 text-muted-foreground hover:text-destructive font-semibold py-3 px-5 rounded-2xl transition-all text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                    <X size={13}/>
                    Cancel — Go back to login
                  </button>
                </div>
                </>)}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Forgot Code Modal ── */}
      {showForgotCode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200 relative">
            <button onClick={()=>setShowForgotCode(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
              <X size={16}/>
            </button>
            <div className="flex flex-col items-center text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <PhoneCall size={28} className="text-primary"/>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-foreground">Need Help With Your Code?</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">Contact the ICT Department to reset your password.</p>
              </div>
              <div className="w-full bg-primary/5 border border-primary/15 rounded-2xl p-5 text-left">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <PhoneCall size={16} className="text-primary"/>
                  </div>
                  <div>
                    <p className="text-xs font-black text-foreground uppercase tracking-tight">ICT Department</p>
                    <p className="text-[10px] text-muted-foreground">Technical Support</p>
                  </div>
                </div>
                {ictPhone
                  ? <a href={`tel:${ictPhone}`} className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all active:scale-[0.98]"><PhoneCall size={15}/> Call {ictPhone}</a>
                  : <p className="text-xs text-muted-foreground italic text-center">Please contact the ICT Department directly.</p>}
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed italic">They will verify your identity and issue a new code promptly.</p>
              <button onClick={()=>setShowForgotCode(false)}
                className="w-full py-3 rounded-xl border border-border/50 text-muted-foreground text-sm font-semibold hover:bg-muted/40 transition-all">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Biometric Enrolment Prompt ── */}
      {showBioEnroll && (
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl p-8 animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Fingerprint size={30} className="text-primary"/>
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Enable Fingerprint Login?</h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-[260px]">
                  Next time you open the app, just tap <strong>Login with Fingerprint</strong> for <span className="text-primary font-semibold">{showBioEnroll}</span> — no password needed.
                </p>
              </div>
              <div className="w-full flex flex-col gap-2.5 pt-1">
                <button
                  onClick={handleBioEnrollYes}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2.5 text-sm shadow-lg shadow-primary/20">
                  <Fingerprint size={17}/>
                  Yes, Enable Fingerprint
                </button>
                <button
                  onClick={() => { setShowBioEnroll(null); setPendingBioCode(''); }}
                  className="w-full border border-border/50 text-muted-foreground font-semibold py-3 rounded-2xl text-xs hover:bg-muted/40 transition-all">
                  Skip for Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
    </>
  );
};

export default Login;
