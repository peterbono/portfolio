import confetti from 'canvas-confetti'

type CelebrationLevel = 'small' | 'medium' | 'big' | 'epic'

const CONFIGS: Record<CelebrationLevel, () => void> = {
  // Task completed, single focus done
  small: () => {
    confetti({
      particleCount: 30,
      spread: 50,
      origin: { y: 0.7 },
      colors: ['#34d399', '#6ee7b7', '#a7f3d0'],
      gravity: 1.2,
      scalar: 0.8,
    })
  },

  // Daily goal reached, all focus tasks done
  medium: () => {
    const duration = 1500
    const end = Date.now() + duration
    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#34d399', '#fbbf24', '#818cf8'],
      })
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#34d399', '#fbbf24', '#818cf8'],
      })
      if (Date.now() < end) requestAnimationFrame(frame)
    }
    frame()
  },

  // Milestone achieved, streak milestone
  big: () => {
    const duration = 2500
    const end = Date.now() + duration
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 }
    const frame = () => {
      confetti({
        ...defaults,
        particleCount: 4,
        origin: { x: Math.random(), y: Math.random() * 0.4 },
        colors: ['#ffd700', '#ff6b6b', '#34d399', '#818cf8', '#fbbf24'],
      })
      if (Date.now() < end) requestAnimationFrame(frame)
    }
    frame()
  },

  // First offer, epic win
  epic: () => {
    const scalar = 2
    const star = confetti.shapeFromText({ text: '⭐', scalar })
    const fire = confetti.shapeFromText({ text: '🔥', scalar })
    const trophy = confetti.shapeFromText({ text: '🏆', scalar })

    const defaults = {
      spread: 360,
      ticks: 100,
      gravity: 0.4,
      decay: 0.94,
      startVelocity: 20,
      zIndex: 9999,
    }

    // Wave 1: stars
    confetti({ ...defaults, particleCount: 20, shapes: [star], scalar, origin: { y: 0.5 } })
    // Wave 2: fire
    setTimeout(() => {
      confetti({ ...defaults, particleCount: 15, shapes: [fire], scalar, origin: { y: 0.4 } })
    }, 400)
    // Wave 3: trophies
    setTimeout(() => {
      confetti({ ...defaults, particleCount: 10, shapes: [trophy], scalar, origin: { y: 0.6 } })
    }, 800)
    // Final burst
    setTimeout(() => {
      confetti({
        particleCount: 100,
        spread: 180,
        origin: { y: 0.5 },
        colors: ['#ffd700', '#ff6b6b', '#34d399', '#818cf8', '#fbbf24', '#f97316'],
        startVelocity: 40,
        gravity: 0.6,
      })
    }, 1200)
  },
}

export function celebrate(level: CelebrationLevel) {
  CONFIGS[level]()
}

// Celebration rules for the Coach
export const CELEBRATION_TRIGGERS = {
  focusTaskDone: 'small' as CelebrationLevel,
  allFocusDone: 'medium' as CelebrationLevel,
  dailyGoalMet: 'medium' as CelebrationLevel,
  streakMilestone7: 'big' as CelebrationLevel,
  streakMilestone30: 'epic' as CelebrationLevel,
  milestoneUnlocked: 'big' as CelebrationLevel,
  firstScreening: 'big' as CelebrationLevel,
  firstInterview: 'big' as CelebrationLevel,
  firstOffer: 'epic' as CelebrationLevel,
  weeklyRankUp: 'medium' as CelebrationLevel,
}
