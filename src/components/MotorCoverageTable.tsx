import { Link } from 'react-router-dom'
import { motorCoverage } from '../lib/profileCoverage'
import type { Motor } from '../types/motor'
import type { ReferenceProfileWithCount } from '../types/reference'

interface Props {
  motors: Motor[]
  profiles: ReferenceProfileWithCount[]
  at: Date
}

/** Per motor: which approved profiles can support an assessment today, and why other profiles cannot. */
export default function MotorCoverageTable({ motors, profiles, at }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Reference profile availability per motor</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3">Motor</th>
            <th scope="col" className="px-4 py-3">Type</th>
            <th scope="col" className="px-4 py-3">Usable approved profiles</th>
            <th scope="col" className="min-w-64 px-4 py-3">Other profiles of this motor type</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {motors.map((m) => {
            const { usable, unusable } = motorCoverage(m, profiles, at)
            const sameType = unusable.filter((u) => u.profile.motor_type.trim().toLowerCase() === m.motor_type.trim().toLowerCase())
            return (
              <tr key={m.id}>
                <th scope="row" className="px-4 py-3 font-medium">
                  <Link to={`/motors/${m.id}`} className="hover:text-amber-700 hover:underline">{m.motor_tag}</Link>
                  <div className="text-xs font-normal text-slate-500">{m.model ?? m.name}</div>
                </th>
                <td className="px-4 py-3">{m.motor_type}</td>
                <td className="px-4 py-3">
                  {usable.length === 0 ? (
                    <span className="text-amber-800">None - an assessment will be INSUFFICIENT_DATA</span>
                  ) : (
                    <ul>
                      {usable.map(({ profile }) => (
                        <li key={profile.id}>
                          <Link to={`/reference/${profile.id}`} className="hover:underline">{profile.name} v{profile.version}</Link>
                          <span className="text-xs text-slate-500"> ({profile.limit_count} {profile.limit_count === 1 ? 'check' : 'checks'})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {sameType.length === 0
                    ? profiles.length === 0 ? 'No profiles exist.' : 'No profile exists for this motor type.'
                    : (
                      <ul className="space-y-1">
                        {sameType.map(({ profile, match }) => (
                          <li key={profile.id}>
                            <Link to={`/reference/${profile.id}`} className="font-medium hover:underline">{profile.name} v{profile.version}</Link>
                            {' - '}{match.reasons.join(' ')}
                          </li>
                        ))}
                      </ul>
                    )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
