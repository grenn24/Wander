import Link from 'next/link';
import LegalPage from '@/components/LegalPage';

export const metadata = {
  title: 'Terms of Service — Wander',
  description: 'The terms you agree to by using Wander.',
};

const CONTACT = 'REPLACE_WITH_YOUR_CONTACT_EMAIL';

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="24 August 2026">
      <p>
        These terms cover your use of Wander, a travel itinerary planner. Using it means
        accepting them.
      </p>

      <h2>What Wander is</h2>
      <p>
        A tool for planning trips: you describe one and it lays out the days, puts the stops on
        a map, totals the cost, and keeps the list you share with whoever is coming. It is
        provided free and as it is.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for what happens under your account and for keeping your sign-in
        details to yourself. Give a real email address — it is the only way to recover the
        account, and the only way we can reach you about it.
      </p>

      <h2>Your content</h2>
      <p>
        Your trips are yours. We claim no ownership of anything you write, and we do not use it
        to train anything. We store and process it only to run the service for you, as
        described in the <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <p>
        Anyone you share a trip with can see and edit that trip. Share links let anyone holding
        the link join the trip, so treat one like a password.
      </p>

      <h2>Fair use</h2>
      <p>Do not use Wander to:</p>
      <ul>
        <li>break the law, or help anyone else to;</li>
        <li>upload other people&rsquo;s private information without their agreement;</li>
        <li>attack, overload or probe the service, or work around its limits;</li>
        <li>resell it, or pass its automated planning off as a service of your own.</li>
      </ul>

      <h2>Plans are suggestions, not advice</h2>
      <p>
        Itineraries, travel times, opening hours, prices and routes are generated
        automatically and from third-party data. They are frequently approximate and sometimes
        wrong. <b>Check anything that matters</b> — flights, visas, bookings, opening times and
        prices — with the airline, the venue or the authority concerned before relying on it.
        Wander is not a travel agent and gives no travel, legal, medical or financial advice.
      </p>

      <h2>Other people&rsquo;s services</h2>
      <p>
        Wander shows maps, places, photographs, ratings and reviews supplied by Google, and
        uses Google Calendar where you connect it. Those parts are subject to{' '}
        <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
          Google&rsquo;s terms
        </a>. Place photographs and reviews belong to the people who made them and are shown
        with attribution.
      </p>
      <p>
        Train times in Japan come from open data. Greater Tokyo&rsquo;s timetables are the
        operators&rsquo;, through the Public Transportation Open Data Center, as gathered by{' '}
        <a href="https://github.com/nagix/mini-tokyo-3d" target="_blank" rel="noreferrer">mini-tokyo-3d</a>{' '}
        (MIT licence). Other timetables are the operators&rsquo; open GTFS feeds, from the{' '}
        <a href="https://gtfs-data.jp/" target="_blank" rel="noreferrer">GTFS Data Repository</a>:
        熊本市交通局 (CC BY 2.1 JP), とさでん交通 (CC BY 4.0), 伊勢鉄道 (CC BY 4.0), 明知鉄道
        (CC BY 4.0), 山形鉄道 (CC BY 4.0), 弘前市 for 弘南鉄道 (CC BY 4.0), and 熊本電鉄,
        富山地方鉄道 and 万葉線 (CC0); and Fukuoka&rsquo;s subway, the Fukuoka City Transportation
        Bureau&rsquo;s, as published by{' '}
        <a href="https://github.com/kuwayamamasayuki/GTFS-FukuokaCitySubway" target="_blank" rel="noreferrer">
          Masayuki Kuwayama
        </a>{' '}
        (CC BY 4.0). English station names outside greater Tokyo come from{' '}
        <a href="https://www.wikidata.org/" target="_blank" rel="noreferrer">Wikidata</a>.
        Elsewhere in Japan, times are estimated from the{' '}
        <a href="https://gtfs-gis.jp/railway_honsu/" target="_blank" rel="noreferrer">
          全国鉄道運行本数データ
        </a>{' '}
        of the University of Tokyo and the Japan Bus Information Association, under CC BY 4.0
        and the ODbL; the database Wander derives from it is offered under the ODbL too.
      </p>

      <h2>No warranty</h2>
      <p>
        Wander is provided &ldquo;as is&rdquo;, without warranty of any kind. It may be
        unavailable, lose data, or produce a plan that is simply wrong. Keep your own copy of
        anything you cannot afford to lose — the print view exists for exactly that.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for any loss arising from using Wander
        — including missed flights, wasted bookings, lost data or ruined afternoons. It is a
        free tool for arranging plans, not a guarantee about them.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop using Wander at any time and ask for your account to be deleted, as set
        out in the <Link href="/privacy">Privacy Policy</Link>. We may suspend an account that
        breaks these terms or endangers the service.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change. The date at the top says when they last did; continuing to use
        Wander after that means accepting the new version.
      </p>

      <h2>Contact</h2>
      <p><a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </LegalPage>
  );
}
