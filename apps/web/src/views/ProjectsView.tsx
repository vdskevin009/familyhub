import type {AppView} from '../types';
import '../property-project.css';
export default function ProjectsView({onNavigate}:{onNavigate:(view:AppView)=>void}){return <section className="property-project"><h1>Projects</h1><div className="project-tiles"><button onClick={()=>onNavigate('groceries')}>Groceries</button><button onClick={()=>onNavigate('mortgage')}>Mortgage</button><button onClick={()=>onNavigate('property')}>Property search</button><button onClick={()=>onNavigate('vehicle')}>Vehicles</button></div></section>;}
