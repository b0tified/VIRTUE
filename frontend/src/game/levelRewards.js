// Level progression rewards (levels 1-10).
// Most of these are flavor + visibility for milestones the player has already
// reached implicitly. The "BIG" rewards (rankUnlock, flameAvatar, animBanner)
// are real, server-gated unlocks that match server.py + Profile.jsx.

import { ShieldCheck, Flame, Crown, Sparkles, Award, Star, Trophy, Zap, Target, Medal } from "lucide-react";

export const LEVEL_REWARDS = [
  {
    level: 1,
    title: "Welcome, Recruit",
    desc: "5 starter avatars + 8 banner icons + 8 colors unlocked.",
    Icon: ShieldCheck,
    accent: "#06A35F",
    big: false,
  },
  {
    level: 2,
    title: "Comic Crew",
    desc: "Profile card title: Recruit. Halftone customization basics ready.",
    Icon: Award,
    accent: "#0055FF",
    big: false,
  },
  {
    level: 3,
    title: "Specialist",
    desc: "Match history saves to your profile (10 most recent).",
    Icon: Target,
    accent: "#9B59B6",
    big: false,
  },
  {
    level: 4,
    title: "Sharpshooter",
    desc: "+5% XP per kill bonus when in a party of 2+ friends.",
    Icon: Star,
    accent: "#5BC0EB",
    big: false,
  },
  {
    level: 5,
    title: "RANKED UNLOCKED",
    desc: "Ranked Match queue opens. Climb the tiers from Bronze → Goonmaster.",
    secondary: "Flaming Skull avatar unlocked.",
    Icon: Trophy,
    accent: "#FFD700",
    big: true,
    cosmetic: { kind: "avatar", idx: 6 },
  },
  {
    level: 6,
    title: "Veteran",
    desc: "Profile card title: Veteran. Friend-list capacity expanded.",
    Icon: Medal,
    accent: "#E62429",
    big: false,
  },
  {
    level: 7,
    title: "Ace Pilot",
    desc: "Spectate-friend cooldown removed — watch as much as you want.",
    Icon: Zap,
    accent: "#FFD700",
    big: false,
  },
  {
    level: 8,
    title: "Elite",
    desc: "Party size cap raised to 4. Lead your squad into ranked.",
    Icon: Sparkles,
    accent: "#06D6A0",
    big: false,
  },
  {
    level: 9,
    title: "Legendary",
    desc: "Profile card title: Legendary. +10% XP per win.",
    Icon: Crown,
    accent: "#9B59B6",
    big: false,
  },
  {
    level: 10,
    title: "ANIMATED BANNERS",
    desc: "Toggle the shimmer sweep on your profile banner. Show off your style.",
    secondary: "Profile card title: General.",
    Icon: Flame,
    accent: "#E62429",
    big: true,
    cosmetic: { kind: "banner-anim" },
  },
];
