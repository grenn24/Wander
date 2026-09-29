import LegalPage from '@/components/LegalPage';

/* Google's reviewer opens this from the consent screen, so it has to be
   reachable, indexable and signed out. */
export const metadata = {
  title: 'Privacy Policy — Wander',
  description: 'What Wander stores, who it sends it to, and how to get rid of it.',
};

const CONTACT = 'REPLACE_WITH_YOUR_CONTACT_EMAIL';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="14 September 2026">
      <p>
        Wander is a travel itinerary planner. This policy describes what it stores, what it
        sends elsewhere, and how to have it deleted. It is written to be read rather than
        skimmed, so it is specific about the parts that matter.
      </p>

      <h2>What Wander stores</h2>
      <ul>
        <li>
          <b>Your account.</b> The email address you sign in with, and a display name. If you
          sign in with Google, the email address and name Google gives us. Passwords are
          handled by our authentication provider and are never visible to us.
        </li>
        <li>
          <b>Your trips.</b> Everything you put in them: trip names, destinations, dates,
          budgets and notes; activities with their times, places, coordinates, costs, booking
          references and notes; packing lists; and the requests and answers in that trip's
          Wander conversation.
        </li>
        <li>
          <b>Who you share a trip with.</b> The display name and email address of each person
          on a shared trip, so members can see who else is on it.
        </li>
        <li>
          <b>Places on your globe.</b> Places you save as somewhere you have been or want to
          go: the name, address and coordinates, and the guide it came from if it did. Only
          you can see them.
        </li>
        <li>
          <b>Google Calendar access, only if you connect it.</b> See the section below.
        </li>
        <li>
          <b>Offline downloads, only when you request them.</b> The itinerary, addresses,
          booking references, notes and packing list are saved in this browser on your device.
          Anyone who can use that browser can read them without signing in again. They are
          snapshots: later changes and access removals cannot reach a device while it is offline.
          Remove a copy in the trip’s Offline settings or sign out of Wander to clear this
          browser’s downloads.
        </li>
      </ul>

      <h2>What Wander does not store</h2>
      <ul>
        <li>
          <b>Pictures you attach when planning.</b> They stay in your browser, are sent once
          to be read, and are never written to our database.
        </li>
        <li>
          <b>Your location.</b> The route screen asks your browser for it to measure the way
          to a place. It is used for that request and not kept.
        </li>
        <li>
          <b>Advertising or analytics data.</b> There are no advertising cookies, no trackers
          and no analytics service. Your browser keeps your sign-in token, display preferences
          and any trips you explicitly download for offline access.
        </li>
      </ul>

      <h2>Google Calendar</h2>
      <p>
        Connecting a calendar is optional, is never part of signing in, and can be undone at
        any time. If you connect one, Wander asks Google for two permissions:
      </p>
      <ul>
        <li>
          <b>Read your calendar</b> (<code>calendar.readonly</code>) — so it can show what you
          already have on during a trip and plan around it.
        </li>
        <li>
          <b>Manage events</b> (<code>calendar.events</code>) — so it can add your trip to your
          calendar when you ask, update those events when the trip changes, and remove them
          again when you ask it to.
        </li>
      </ul>
      <p>
        <b>Only a trip&rsquo;s own dates are ever read.</b> Every request is bounded by the start
        and end date of the trip you are looking at; Wander never asks for your calendar in
        general. From each event it reads the title, the start and end, the location and the
        description, and nothing else. Events that Wander itself wrote are filtered out of
        what it reads back.
      </p>
      <p>
        <b>Calendar entries are sent to our planning provider</b> (OpenAI) when you use a
        feature that plans around them — creating a trip, asking for suggestions for a day, or
        asking the command bar to change something. That is how the wedding in your calendar
        ends up in your itinerary with its real address. If you would rather that did not
        happen, do not connect a calendar.
      </p>
      <p>
        <b>Writing is limited to events Wander created.</b> Every event it adds carries a
        hidden marker naming the trip it came from. It only ever updates or deletes events
        carrying that marker; it does not touch anything else in your calendar.
      </p>
      <p>
        The access it holds is a refresh token stored on our server, in a table that no user
        account can read — not even yours. It never returns to your browser after the moment
        Google issues it. Disconnecting deletes it and revokes it at Google in the same step.
      </p>
      <p>
        Wander&rsquo;s use and transfer of information received from Google APIs to any other
        app adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including
        the Limited Use requirements. Google user data is never sold, never used for
        advertising, and never used to train any model.
      </p>

      <h2>Who else sees your data</h2>
      <p>
        Wander has no employees reading your trips and sells nothing to anyone. It does rely
        on these services to work:
      </p>
      <ul>
        <li>
          <b>Supabase</b> — stores the database and runs sign-in.
        </li>
        <li>
          <b>Vercel</b> — hosts the application.
        </li>
        <li>
          <b>OpenAI</b> — turns your requests into plans. It receives what you type or attach,
          recent Wander conversation for that trip, the trip and its activities when you ask
          for a change, and calendar entries within the trip&rsquo;s dates when a calendar is
          connected. It does not receive your email address or your account.
        </li>
        <li>
          <b>Google Maps Platform</b> — draws maps, searches for places, supplies place photos,
          ratings and reviews, and works out routes. It receives the place names you search
          for and the coordinates being shown.
        </li>
        <li>
          <b>Unsplash</b> and <b>Wikimedia Commons</b> — serve the photographs in guides.
          Your browser requests each photograph from whichever of the two it came from when
          a guide page shows it.
        </li>
        <li>
          <b>YouTube</b> — only when you press play on a guide&rsquo;s video. Until then only
          a still image is shown; pressing play loads YouTube&rsquo;s privacy-enhanced player,
          and YouTube then receives that request.
        </li>
      </ul>

      <h2>Deleting things</h2>
      <ul>
        <li><b>An activity or a trip</b> — delete it in the app; it goes immediately, along with
          everything in it.
        </li>
        <li><b>A place on your globe</b> — select it on the globe and remove it.
        </li>
        <li><b>The calendar connection</b> — Account → Disconnect. The stored permission is
          deleted and revoked at Google straight away. Events already written to your calendar
          stay unless you remove them, which the trip&rsquo;s Calendar panel will do for you.
        </li>
        <li><b>Your whole account</b> — email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from
          the address you signed up with. Everything is deleted within 30 days.
        </li>
      </ul>

      <h2>Children</h2>
      <p>Wander is not intended for children under 13, and accounts are not knowingly created for them.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that affects what happens to your data, the date at the
        top changes with it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, or a deletion request: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalPage>
  );
}
