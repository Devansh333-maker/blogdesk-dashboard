import {BarChart3,BookOpen,CircleDollarSign,Clock3,LayoutDashboard} from 'lucide-react';

const reports=[
  {id:'dashboard',href:'/',label:'Dashboard',icon:LayoutDashboard},
  {id:'analytics',href:'/analytics',label:'Blog analytics',icon:BarChart3},
  {id:'cost',href:'/cost-analysis',label:'Cost analysis',icon:CircleDollarSign},
  {id:'efficiency',href:'/efficiency',label:'Time & efficiency',icon:Clock3},
] as const;

export function ReportNavigation({active}:{active:'analytics'|'cost'|'efficiency'}) {
  return <nav className="report-navigation" aria-label="Dashboard sections">
    <a className="report-brand" href="/" aria-label="BlogDesk dashboard"><BookOpen aria-hidden="true" size={18}/><span>BlogDesk</span></a>
    <div className="report-nav-links">{reports.map(({id,href,label,icon:Icon})=><a key={id} href={href} aria-current={id===active?'page':undefined}><Icon aria-hidden="true" size={15}/>{label}</a>)}</div>
  </nav>;
}
