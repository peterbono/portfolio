import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  classifyJobEmail,
  extractCompanyFromEmail,
  getGmailAppliedCompanies,
} from '../gmail-scanner'

// ═══════════════════════════════════════════════════════════════════════
//  classifyJobEmail
// ═══════════════════════════════════════════════════════════════════════

describe('classifyJobEmail', () => {
  // ─── Rejection keywords ──────────────────────────────────────────
  describe('rejection classification', () => {
    it('detects "unfortunately"', () => {
      expect(
        classifyJobEmail(
          'Unfortunately, we will not be proceeding with your application',
          'Netflix Careers <careers@netflix.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "not moving forward"', () => {
      expect(
        classifyJobEmail(
          'Update on your application — we are not moving forward',
          'Grab Hiring <hiring@grab.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "other candidates"', () => {
      expect(
        classifyJobEmail(
          'We have decided to pursue other candidates at this time',
          'talent@deel.com',
        ),
      ).toBe('rejection')
    })

    it('detects "not selected"', () => {
      expect(
        classifyJobEmail(
          'You were not selected for the Product Designer role',
          'Shopee Careers <noreply@shopee.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "regret to inform"', () => {
      expect(
        classifyJobEmail(
          'We regret to inform you that the position has been filled',
          'hr@agoda.com',
        ),
      ).toBe('rejection')
    })

    it('detects "position has been filled"', () => {
      expect(
        classifyJobEmail(
          'The position has been filled — thank you for your interest',
          'Lazada <careers@lazada.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "decided not to proceed"', () => {
      expect(
        classifyJobEmail(
          'We have decided not to proceed with your candidacy',
          'Wise Talent <talent@wise.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "will not be moving forward"', () => {
      expect(
        classifyJobEmail(
          'After careful consideration, we will not be moving forward',
          'Revolut Careers <recruiting@revolut.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "not the right fit"', () => {
      expect(
        classifyJobEmail(
          'We feel this is not the right fit at this time',
          'Canva <no-reply@canva.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "we have decided to pursue"', () => {
      expect(
        classifyJobEmail(
          'We have decided to pursue a different direction',
          'Stripe <careers@stripe.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "decided to move forward with"', () => {
      expect(
        classifyJobEmail(
          'We have decided to move forward with another candidate',
          'Figma <jobs@figma.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "we went with another"', () => {
      expect(
        classifyJobEmail(
          'We went with another candidate for the role',
          'Spotify <noreply@spotify.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "we chose another"', () => {
      expect(
        classifyJobEmail(
          'Ultimately, we chose another candidate',
          'Airbnb Careers <careers@airbnb.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "application was not successful"', () => {
      expect(
        classifyJobEmail(
          'Your application was not successful',
          'Booking.com <no-reply@booking.com>',
        ),
      ).toBe('rejection')
    })

    it('detects "unable to offer"', () => {
      expect(
        classifyJobEmail(
          'We are unable to offer you a position at this time',
          'Klook <talent@klook.com>',
        ),
      ).toBe('rejection')
    })
  })

  // ─── Confirmation keywords ───────────────────────────────────────
  describe('confirmation classification', () => {
    it('detects "application received"', () => {
      expect(
        classifyJobEmail(
          'Your application received for Senior Designer',
          'Notion Careers <noreply@notion.so>',
        ),
      ).toBe('confirmation')
    })

    it('detects "application submitted"', () => {
      expect(
        classifyJobEmail(
          'Application submitted: Product Designer at Grab',
          'Greenhouse <no-reply@greenhouse.io>',
        ),
      ).toBe('confirmation')
    })

    it('detects "application was sent"', () => {
      expect(
        classifyJobEmail(
          'Florian, your application was sent to Netflix',
          'LinkedIn <jobs-noreply@linkedin.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "you applied to"', () => {
      expect(
        classifyJobEmail(
          'Florian, you applied to UX Designer at Shopee',
          'LinkedIn <jobs-noreply@linkedin.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "thank you for applying"', () => {
      expect(
        classifyJobEmail(
          'Thank you for applying to Agoda!',
          'Agoda Talent <careers@agoda.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "we received your application"', () => {
      expect(
        classifyJobEmail(
          'We received your application for Lead Designer',
          'Deel Careers <no-reply@deel.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "thanks for your interest"', () => {
      expect(
        classifyJobEmail(
          'Thanks for your interest in the design team at Canva',
          'Canva <recruiting@canva.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "application has been received"', () => {
      expect(
        classifyJobEmail(
          'Your application has been received — Product Designer',
          'Lever <no-reply@lever.co>',
        ),
      ).toBe('confirmation')
    })

    it('detects "successfully submitted"', () => {
      expect(
        classifyJobEmail(
          'Your application was successfully submitted',
          'Workable <noreply@workable.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "we have received your"', () => {
      expect(
        classifyJobEmail(
          'We have received your resume for UX/UI Designer',
          'Traveloka HR <hr@traveloka.com>',
        ),
      ).toBe('confirmation')
    })

    it('detects "thanks for applying"', () => {
      expect(
        classifyJobEmail(
          'Thanks for applying, Florian!',
          'Wise <jobs@wise.com>',
        ),
      ).toBe('confirmation')
    })
  })

  // ─── Interview keywords ──────────────────────────────────────────
  describe('interview classification', () => {
    it('detects "interview"', () => {
      expect(
        classifyJobEmail(
          'Interview invitation: Senior Product Designer',
          'Grab Talent <talent@grab.com>',
        ),
      ).toBe('interview')
    })

    it('detects "schedule a call"', () => {
      expect(
        classifyJobEmail(
          'We would like to schedule a call with you',
          'Deel Recruiting <recruiting@deel.com>',
        ),
      ).toBe('interview')
    })

    it('detects "phone screen"', () => {
      expect(
        classifyJobEmail(
          'Phone screen: Product Designer position',
          'Netflix <careers@netflix.com>',
        ),
      ).toBe('interview')
    })

    it('detects "next steps"', () => {
      expect(
        classifyJobEmail(
          'Next steps for your application at Agoda',
          'Agoda Careers <hr@agoda.com>',
        ),
      ).toBe('interview')
    })

    it('detects "meet the team"', () => {
      expect(
        classifyJobEmail(
          'We would like you to meet the team!',
          'Shopee <recruiting@shopee.com>',
        ),
      ).toBe('interview')
    })

    it('detects "technical assessment"', () => {
      expect(
        classifyJobEmail(
          'Technical assessment for Senior UX Designer',
          'Canva Hiring <jobs@canva.com>',
        ),
      ).toBe('interview')
    })

    it('detects "design challenge"', () => {
      expect(
        classifyJobEmail(
          'Design challenge: next round',
          'Figma Recruiting <talent@figma.com>',
        ),
      ).toBe('interview')
    })

    it('detects "take-home"', () => {
      expect(
        classifyJobEmail(
          'Your take-home assignment is ready',
          'Stripe <careers@stripe.com>',
        ),
      ).toBe('interview')
    })

    it('detects "would like to invite you"', () => {
      expect(
        classifyJobEmail(
          'We would like to invite you for a conversation',
          'Wise <hr@wise.com>',
        ),
      ).toBe('interview')
    })

    it('detects "calendly"', () => {
      expect(
        classifyJobEmail(
          'Book a time via Calendly for your design review',
          'Notion <recruiting@notion.so>',
        ),
      ).toBe('interview')
    })

    it('detects "video call"', () => {
      expect(
        classifyJobEmail(
          'Your video call is confirmed for Thursday',
          'Revolut <talent@revolut.com>',
        ),
      ).toBe('interview')
    })

    it('detects "panel discussion"', () => {
      expect(
        classifyJobEmail(
          'Panel discussion with our design leadership',
          'Spotify <careers@spotify.com>',
        ),
      ).toBe('interview')
    })

    it('detects "set up a time"', () => {
      expect(
        classifyJobEmail(
          'Can we set up a time to chat?',
          'Rachel at Deel <rachel@lever.co>',
        ),
      ).toBe('interview')
    })

    it('detects "availability for"', () => {
      expect(
        classifyJobEmail(
          'Your availability for a quick sync?',
          'Airbnb <jobs@airbnb.com>',
        ),
      ).toBe('interview')
    })
  })

  // ─── Offer keywords ──────────────────────────────────────────────
  describe('offer classification', () => {
    it('detects "offer letter"', () => {
      expect(
        classifyJobEmail(
          'Your offer letter — Senior Product Designer',
          'Grab HR <hr@grab.com>',
        ),
      ).toBe('offer')
    })

    it('detects "job offer"', () => {
      expect(
        classifyJobEmail(
          'Job offer: Lead UX Designer',
          'Shopee <talent@shopee.com>',
        ),
      ).toBe('offer')
    })

    it('detects "compensation"', () => {
      expect(
        classifyJobEmail(
          'Compensation details for your new role',
          'Canva People <people@canva.com>',
        ),
      ).toBe('offer')
    })

    it('detects "start date"', () => {
      expect(
        classifyJobEmail(
          'Confirming your start date — welcome to the team!',
          'Netflix HR <hr@netflix.com>',
        ),
      ).toBe('offer')
    })

    it('detects "we are pleased to offer"', () => {
      expect(
        classifyJobEmail(
          'We are pleased to offer you the position of Product Designer',
          'Deel <hr@deel.com>',
        ),
      ).toBe('offer')
    })

    it('detects "formal offer"', () => {
      expect(
        classifyJobEmail(
          'Your formal offer is ready for review',
          'Stripe <people@stripe.com>',
        ),
      ).toBe('offer')
    })

    it('detects "congratulations"', () => {
      expect(
        classifyJobEmail(
          'Congratulations! You have been selected',
          'Figma <careers@figma.com>',
        ),
      ).toBe('offer')
    })

    it('detects "welcome aboard"', () => {
      expect(
        classifyJobEmail(
          'Welcome aboard, Florian!',
          'Agoda <people@agoda.com>',
        ),
      ).toBe('offer')
    })
  })

  // ─── IGNORE_SUBJECT_PATTERNS ─────────────────────────────────────
  describe('ignore patterns (false positives)', () => {
    it('ignores "security code" emails', () => {
      expect(
        classifyJobEmail(
          'Your security code for LinkedIn',
          'LinkedIn <security-noreply@linkedin.com>',
        ),
      ).toBeNull()
    })

    it('ignores "verification code" emails', () => {
      expect(
        classifyJobEmail(
          'Your verification code is 123456',
          'no-reply@greenhouse.io',
        ),
      ).toBeNull()
    })

    it('ignores "verify your email" emails', () => {
      expect(
        classifyJobEmail(
          'Please verify your email address',
          'Lever <noreply@lever.co>',
        ),
      ).toBeNull()
    })

    it('ignores "don\'t forget to complete" emails', () => {
      expect(
        classifyJobEmail(
          "Don't forget to complete your application for Designer",
          'LinkedIn <jobs-noreply@linkedin.com>',
        ),
      ).toBeNull()
    })

    it('ignores "complete your application" emails', () => {
      expect(
        classifyJobEmail(
          'Complete your application at Netflix',
          'Netflix Careers <careers@netflix.com>',
        ),
      ).toBeNull()
    })

    it('ignores "finish your application" emails', () => {
      expect(
        classifyJobEmail(
          'Finish your application for Senior UX Designer',
          'Workable <noreply@workable.com>',
        ),
      ).toBeNull()
    })

    it('ignores "reminder to apply" emails', () => {
      expect(
        classifyJobEmail(
          'Reminder to apply: jobs similar to your search',
          'LinkedIn <jobs-noreply@linkedin.com>',
        ),
      ).toBeNull()
    })

    it('ignores "password reset" emails', () => {
      expect(
        classifyJobEmail(
          'Password reset requested',
          'Greenhouse <noreply@greenhouse.io>',
        ),
      ).toBeNull()
    })

    it('ignores "confirm your email" emails', () => {
      expect(
        classifyJobEmail(
          'Confirm your email address to continue',
          'Ashby <noreply@ashbyhq.com>',
        ),
      ).toBeNull()
    })

    it('ignores "activate your account" emails', () => {
      expect(
        classifyJobEmail(
          'Activate your account on Lever',
          'Lever <noreply@lever.co>',
        ),
      ).toBeNull()
    })
  })

  // ─── Priority order ──────────────────────────────────────────────
  describe('priority order: offer > interview > rejection > confirmation', () => {
    it('offer beats interview when both match', () => {
      // "congratulations" = offer, "interview" = interview
      expect(
        classifyJobEmail(
          'Congratulations on completing your interview — here is your offer letter',
          'Netflix <hr@netflix.com>',
        ),
      ).toBe('offer')
    })

    it('offer beats rejection when both match', () => {
      // "congratulations" = offer, "unfortunately" in from? let's embed in subject
      expect(
        classifyJobEmail(
          'Congratulations! Unfortunately the other role was filled but we are pleased to offer you this one',
          'Canva <hr@canva.com>',
        ),
      ).toBe('offer')
    })

    it('interview beats rejection when both match', () => {
      // "next steps" = interview, "other candidates" = rejection
      expect(
        classifyJobEmail(
          'Next steps: we narrowed to you among other candidates',
          'Shopee <talent@shopee.com>',
        ),
      ).toBe('interview')
    })

    it('rejection beats confirmation when both match', () => {
      // "unfortunately" = rejection, "thank you for applying" = confirmation
      expect(
        classifyJobEmail(
          'Thank you for applying. Unfortunately, we will not be proceeding.',
          'Deel Careers <careers@deel.com>',
        ),
      ).toBe('rejection')
    })

    it('interview beats confirmation when both match', () => {
      // "we received your application" = confirmation, "interview" = interview
      expect(
        classifyJobEmail(
          'We received your application — interview scheduled for Monday',
          'Grab <talent@grab.com>',
        ),
      ).toBe('interview')
    })
  })

  // ─── Edge cases ──────────────────────────────────────────────────
  describe('edge cases', () => {
    it('security code email with "your application" text returns null (ignored)', () => {
      expect(
        classifyJobEmail(
          'Security code for your application account at LinkedIn',
          'LinkedIn <security-noreply@linkedin.com>',
        ),
      ).toBeNull()
    })

    it('returns null for empty subject and from', () => {
      expect(classifyJobEmail('', '')).toBeNull()
    })

    it('returns null for unrelated email', () => {
      expect(
        classifyJobEmail(
          'Your Amazon order has shipped',
          'Amazon <ship-confirm@amazon.com>',
        ),
      ).toBeNull()
    })

    it('returns null for generic newsletter', () => {
      expect(
        classifyJobEmail(
          'Top 10 design trends for 2026',
          'Dribbble <newsletter@dribbble.com>',
        ),
      ).toBeNull()
    })

    it('keyword match is case-insensitive', () => {
      expect(
        classifyJobEmail(
          'UNFORTUNATELY we cannot proceed',
          'HR <hr@example.com>',
        ),
      ).toBe('rejection')
    })

    it('keyword in from field also triggers classification', () => {
      // "interview" appears only in the from field display name
      expect(
        classifyJobEmail(
          'Your Agoda update',
          'Interview Scheduler <interview@agoda.com>',
        ),
      ).toBe('interview')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  extractCompanyFromEmail
// ═══════════════════════════════════════════════════════════════════════

describe('extractCompanyFromEmail', () => {
  // ─── Display name extraction ─────────────────────────────────────
  describe('sender display name extraction', () => {
    it('extracts company from simple display name', () => {
      expect(
        extractCompanyFromEmail(
          'Netflix <careers@netflix.com>',
          'Your application update',
        ),
      ).toBe('Netflix')
    })

    it('extracts multi-word company name', () => {
      expect(
        extractCompanyFromEmail(
          'Booking.com <no-reply@booking.com>',
          'Thank you for applying',
        ),
      ).toBe('Booking.com')
    })

    it('extracts company from quoted display name', () => {
      expect(
        extractCompanyFromEmail(
          '"Grab" <careers@grab.com>',
          'Application received',
        ),
      ).toBe('Grab')
    })
  })

  // ─── Person name detection (falls through to subject) ────────────
  describe('person name detection — falls through to subject', () => {
    it('detects 2-word person name and falls through', () => {
      expect(
        extractCompanyFromEmail(
          'Rachel Hernandez <rachel@lever.co>',
          'Your application to Designer at Spotify was sent',
        ),
      ).toBe('Spotify')
    })

    it('detects single common first name and falls through', () => {
      expect(
        extractCompanyFromEmail(
          'Florian <florian@gmail.com>',
          'Your application to UX Lead at Canva',
        ),
      ).toBe('Canva')
    })

    it('does NOT treat all-caps as a person name', () => {
      expect(
        extractCompanyFromEmail(
          'EPAM <careers@epam.com>',
          'Application update',
        ),
      ).toBe('EPAM')
    })

    it('does NOT treat single non-name word as person', () => {
      // "Deel" is not in the common first names list
      expect(
        extractCompanyFromEmail(
          'Deel <careers@deel.com>',
          'Some subject',
        ),
      ).toBe('Deel')
    })

    it('does NOT treat 4+ word string as person name', () => {
      expect(
        extractCompanyFromEmail(
          'The New York Times <jobs@nytimes.com>',
          'Application received',
        ),
      ).toBe('The New York Times')
    })

    it('does NOT treat name with company indicator as person', () => {
      // "Deel Inc" has a company indicator
      expect(
        extractCompanyFromEmail(
          'Deel Inc <careers@deel.com>',
          'Application update',
        ),
      ).toBe('Deel')
    })
  })

  // ─── Person-dash-company patterns ────────────────────────────────
  describe('person-dash-company and company-dash-person patterns', () => {
    it('extracts company from "Person - Company" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'Senka Muslibegovic - WorkFlex <senka@workflex.com>',
          'Your application update',
        ),
      ).toBe('WorkFlex')
    })

    it('extracts company from "Company - Person" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'WorkFlex - Senka Muslibegovic <senka@workflex.com>',
          'Your application update',
        ),
      ).toBe('WorkFlex')
    })

    it('handles em-dash separator', () => {
      expect(
        extractCompanyFromEmail(
          'Anna Chen\u2014Revolut <anna@revolut.com>',
          'Quick update on your role',
        ),
      ).toBe('Revolut')
    })

    it('handles pipe separator', () => {
      expect(
        extractCompanyFromEmail(
          'David Kim | Canva <david.kim@canva.com>',
          'Design challenge next steps',
        ),
      ).toBe('Canva')
    })
  })

  // ─── Via LinkedIn / ATS platform senders ─────────────────────────
  describe('via LinkedIn and ATS platform senders', () => {
    it('falls through for "Person via LinkedIn" to subject parsing', () => {
      expect(
        extractCompanyFromEmail(
          'John Smith via LinkedIn <noreply@linkedin.com>',
          'Your application to UX Designer at Shopee was sent',
        ),
      ).toBe('Shopee')
    })

    it('falls through for generic LinkedIn sender', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <jobs-noreply@linkedin.com>',
          'Your application to Designer at Netflix was sent',
        ),
      ).toBe('Netflix')
    })

    it('falls through for Greenhouse sender', () => {
      expect(
        extractCompanyFromEmail(
          'Greenhouse <no-reply@greenhouse.io>',
          'Your application to Senior Product Designer at Figma',
        ),
      ).toBe('Figma')
    })

    it('falls through for Lever sender', () => {
      expect(
        extractCompanyFromEmail(
          'Lever <notifications@lever.co>',
          'Florian, your application was sent to Stripe',
        ),
      ).toBe('Stripe')
    })

    it('falls through for Workable sender', () => {
      expect(
        extractCompanyFromEmail(
          'Workable <noreply@workable.com>',
          'Your application to Lead Designer at Wise',
        ),
      ).toBe('Wise')
    })

    it('falls through for Ashby sender', () => {
      expect(
        extractCompanyFromEmail(
          'Ashby <no-reply@ashbyhq.com>',
          'Deel sent you a message',
        ),
      ).toBe('Deel')
    })
  })

  // ─── Prefix / suffix stripping ──────────────────────────────────
  describe('prefix and suffix stripping from display name', () => {
    it('strips "Careers" prefix', () => {
      expect(
        extractCompanyFromEmail(
          'Careers Netflix <careers@netflix.com>',
          'Application update',
        ),
      ).toBe('Netflix')
    })

    it('strips "Careers at" prefix', () => {
      expect(
        extractCompanyFromEmail(
          'Careers at Spotify <careers@spotify.com>',
          'Application received',
        ),
      ).toBe('Spotify')
    })

    it('strips "Careers" suffix', () => {
      expect(
        extractCompanyFromEmail(
          'Netflix Careers <careers@netflix.com>',
          'Application update',
        ),
      ).toBe('Netflix')
    })

    it('strips "Jobs" suffix', () => {
      expect(
        extractCompanyFromEmail(
          'Deel Jobs <jobs@deel.com>',
          'Thank you for applying',
        ),
      ).toBe('Deel')
    })

    it('strips "Hiring Team" suffix', () => {
      expect(
        extractCompanyFromEmail(
          'Netflix Hiring Team <talent@netflix.com>',
          'Application update',
        ),
      ).toBe('Netflix')
    })

    it('strips "Talent Acquisition" suffix', () => {
      expect(
        extractCompanyFromEmail(
          'Grab Talent Acquisition <talent@grab.com>',
          'Update on your role',
        ),
      ).toBe('Grab')
    })

    it('strips legal suffix "Inc."', () => {
      expect(
        extractCompanyFromEmail(
          'Netflix Inc. <legal@netflix.com>',
          'Offer details',
        ),
      ).toBe('Netflix')
    })

    it('strips legal suffix ", Inc."', () => {
      expect(
        extractCompanyFromEmail(
          'Netflix, Inc. <legal@netflix.com>',
          'Offer details',
        ),
      ).toBe('Netflix')
    })

    it('strips "Hiring" prefix', () => {
      expect(
        extractCompanyFromEmail(
          'Hiring at Revolut <hiring@revolut.com>',
          'Role update',
        ),
      ).toBe('Revolut')
    })

    it('strips "Recruiting" suffix', () => {
      expect(
        extractCompanyFromEmail(
          'Canva Recruiting <recruiting@canva.com>',
          'Interview details',
        ),
      ).toBe('Canva')
    })
  })

  // ─── cleanCompanyName via extractCompanyFromEmail ─────────────────
  describe('cleanCompanyName behavior (via extraction)', () => {
    it('cleans "Netflix, Inc." to "Netflix"', () => {
      expect(
        extractCompanyFromEmail(
          'Netflix, Inc. <careers@netflix.com>',
          'Your application',
        ),
      ).toBe('Netflix')
    })

    it('cleans "Grab Hiring" to "Grab"', () => {
      expect(
        extractCompanyFromEmail(
          'Grab Hiring <hiring@grab.com>',
          'Next steps',
        ),
      ).toBe('Grab')
    })

    it('cleans "Careers at Netflix" to "Netflix"', () => {
      expect(
        extractCompanyFromEmail(
          'Careers at Netflix <careers@netflix.com>',
          'Update',
        ),
      ).toBe('Netflix')
    })

    it('cleans "Shopee Ltd" to "Shopee"', () => {
      expect(
        extractCompanyFromEmail(
          'Shopee Ltd <hr@shopee.com>',
          'Offer letter',
        ),
      ).toBe('Shopee')
    })

    it('cleans "Wise GmbH" to "Wise"', () => {
      expect(
        extractCompanyFromEmail(
          'Wise GmbH <legal@wise.com>',
          'Contract details',
        ),
      ).toBe('Wise')
    })
  })

  // ─── Subject line patterns ───────────────────────────────────────
  describe('subject line extraction patterns', () => {
    it('LinkedIn "at COMPANY was sent" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <jobs-noreply@linkedin.com>',
          'Your application to Senior Product Designer at Netflix was sent',
        ),
      ).toBe('Netflix')
    })

    it('LinkedIn "at COMPANY" at end of subject', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <jobs-noreply@linkedin.com>',
          'Your application to UX Lead at Canva',
        ),
      ).toBe('Canva')
    })

    it('"COMPANY sent you a message" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <notifications@linkedin.com>',
          'Netflix sent you a message',
        ),
      ).toBe('Netflix')
    })

    it('"COMPANY viewed your application" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <notifications@linkedin.com>',
          'Shopee viewed your application',
        ),
      ).toBe('Shopee')
    })

    it('"COMPANY is interested" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <notifications@linkedin.com>',
          'Grab is interested in your profile',
        ),
      ).toBe('Grab')
    })

    it('"sent to COMPANY" subject pattern with "at" match', () => {
      expect(
        extractCompanyFromEmail(
          'Lever <no-reply@lever.co>',
          'Florian, your application was sent to Netflix',
        ),
      ).toBe('Netflix')
    })

    it('"at COMPANY was viewed" pattern', () => {
      expect(
        extractCompanyFromEmail(
          'LinkedIn <jobs-noreply@linkedin.com>',
          'Your application to Designer at Spotify was viewed',
        ),
      ).toBe('Spotify')
    })
  })

  // ─── Domain fallback ─────────────────────────────────────────────
  describe('domain fallback extraction', () => {
    it('falls back to domain SLD when display name is generic', () => {
      expect(
        extractCompanyFromEmail(
          'noreply <noreply@acme.com>',
          'Your weekly report',
        ),
      ).toBe('Acme')
    })

    it('capitalizes first letter of domain SLD', () => {
      expect(
        extractCompanyFromEmail(
          'no-reply <no-reply@zendesk.com>',
          'Account notification',
        ),
      ).toBe('Zendesk')
    })

    it('returns "Unknown" for generic ATS domain with no subject match', () => {
      expect(
        extractCompanyFromEmail(
          'no-reply <no-reply@greenhouse.io>',
          'Your weekly report',
        ),
      ).toBe('Unknown')
    })

    it('returns "Unknown" for generic email domain with no subject match', () => {
      expect(
        extractCompanyFromEmail(
          'notifications <notifications@lever.co>',
          'System notification',
        ),
      ).toBe('Unknown')
    })

    it('returns display name for Gmail sender with no subject match (not generic)', () => {
      // "someone" is not in the generic blocklist, so it's used as company name
      expect(
        extractCompanyFromEmail(
          'someone <someone@gmail.com>',
          'Hey there',
        ),
      ).toBe('someone')
    })

    it('extracts from subdomain correctly (uses SLD)', () => {
      expect(
        extractCompanyFromEmail(
          'noreply <noreply@mail.shopify.com>',
          'Random subject',
        ),
      ).toBe('Shopify')
    })
  })

  // ─── No display name — email only ─────────────────────────────────
  describe('email-only sender (no display name)', () => {
    it('falls to domain when no display name and no angle brackets', () => {
      expect(
        extractCompanyFromEmail(
          'careers@acme.com',
          'Random subject with no company',
        ),
      ).toBe('Acme')
    })

    it('handles angle brackets without display name', () => {
      expect(
        extractCompanyFromEmail(
          '<careers@zendesk.com>',
          'No subject match',
        ),
      ).toBe('Zendesk')
    })
  })

  // ─── Real-world LinkedIn subject fixtures ─────────────────────────
  describe('real-world LinkedIn email fixtures', () => {
    const linkedinFrom = 'LinkedIn <jobs-noreply@linkedin.com>'

    it('parses "Florian, you applied to Product Designer at Agoda"', () => {
      expect(
        extractCompanyFromEmail(
          linkedinFrom,
          'Florian, you applied to Product Designer at Agoda',
        ),
      ).toBe('Agoda')
    })

    it('parses "Your application to Senior UX Designer at Grab was sent"', () => {
      expect(
        extractCompanyFromEmail(
          linkedinFrom,
          'Your application to Senior UX Designer at Grab was sent',
        ),
      ).toBe('Grab')
    })

    it('parses "Your application to Lead Product Designer at Wise was received"', () => {
      expect(
        extractCompanyFromEmail(
          linkedinFrom,
          'Your application to Lead Product Designer at Wise was received',
        ),
      ).toBe('Wise')
    })

    it('parses "Your application to Staff Designer at Canva"', () => {
      expect(
        extractCompanyFromEmail(
          linkedinFrom,
          'Your application to Staff Designer at Canva',
        ),
      ).toBe('Canva')
    })
  })

  // ─── Edge cases & fallbacks ──────────────────────────────────────
  describe('edge cases', () => {
    it('returns "Unknown" when nothing matches at all', () => {
      expect(
        extractCompanyFromEmail('', ''),
      ).toBe('Unknown')
    })

    it('handles special characters in company name', () => {
      expect(
        extractCompanyFromEmail(
          'AT&T <careers@att.com>',
          'Application update',
        ),
      ).toBe('AT&T')
    })

    it('does not extract person name from "COMPANY sent" pattern', () => {
      // "Sarah Johnson" looks like a person name — should NOT be extracted as company
      // The companySent regex checks isLikelyPersonName and skips if true
      expect(
        extractCompanyFromEmail(
          'LinkedIn <notifications@linkedin.com>',
          'Sarah Johnson sent you a message',
        ),
      ).not.toBe('Sarah Johnson')
    })

    it('handles "via Greenhouse" in sender', () => {
      expect(
        extractCompanyFromEmail(
          'John via Greenhouse <noreply@greenhouse.io>',
          'Your application to Designer at Figma was sent',
        ),
      ).toBe('Figma')
    })

    it('handles "via Indeed" in sender', () => {
      expect(
        extractCompanyFromEmail(
          'Recruiter via Indeed <noreply@indeed.com>',
          'Your application to UX Designer at Deel',
        ),
      ).toBe('Deel')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getGmailAppliedCompanies
// ═══════════════════════════════════════════════════════════════════════

describe('getGmailAppliedCompanies', () => {
  const LS_KEY = 'tracker_v2_gmail_api_events'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns empty set when localStorage has no cached events', () => {
    const result = getGmailAppliedCompanies()
    expect(result.size).toBe(0)
  })

  it('returns empty set when cached events is empty array', () => {
    localStorage.setItem(LS_KEY, JSON.stringify([]))
    const result = getGmailAppliedCompanies()
    expect(result.size).toBe(0)
  })

  it('returns only companies from confirmation events', () => {
    localStorage.setItem(LS_KEY, JSON.stringify([
      { type: 'confirmation', company: 'Netflix', date: '2026-03-15', subject: 'Application received' },
      { type: 'rejection', company: 'Stripe', date: '2026-03-16', subject: 'Unfortunately...' },
      { type: 'confirmation', company: 'Deel', date: '2026-03-17', subject: 'Thank you for applying' },
      { type: 'interview', company: 'Figma', date: '2026-03-18', subject: 'Interview scheduled' },
    ]))

    const result = getGmailAppliedCompanies()
    expect(result.size).toBe(2)
    expect(result.has('netflix')).toBe(true)
    expect(result.has('deel')).toBe(true)
    expect(result.has('stripe')).toBe(false)
    expect(result.has('figma')).toBe(false)
  })

  it('returns lowercased company names', () => {
    localStorage.setItem(LS_KEY, JSON.stringify([
      { type: 'confirmation', company: 'Netflix', date: '2026-03-15', subject: 'test' },
      { type: 'confirmation', company: 'CANVA', date: '2026-03-16', subject: 'test' },
    ]))

    const result = getGmailAppliedCompanies()
    expect(result.has('netflix')).toBe(true)
    expect(result.has('canva')).toBe(true)
    expect(result.has('Netflix')).toBe(false)
  })

  it('returns empty set when localStorage contains invalid JSON', () => {
    localStorage.setItem(LS_KEY, 'not-valid-json')
    const result = getGmailAppliedCompanies()
    expect(result.size).toBe(0)
  })

  it('trims company names', () => {
    localStorage.setItem(LS_KEY, JSON.stringify([
      { type: 'confirmation', company: '  Netflix  ', date: '2026-03-15', subject: 'test' },
    ]))

    const result = getGmailAppliedCompanies()
    expect(result.has('netflix')).toBe(true)
  })
})
