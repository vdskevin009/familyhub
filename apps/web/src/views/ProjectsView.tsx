import type {AppView} from '../types';
import '../property-project.css';
export default function ProjectsView({onNavigate}:{onNavigate:(view:AppView)=>void}){return <section className="property-project"><h1>Projets</h1><div className="project-tiles"><button onClick={()=>onNavigate('groceries')}>Courses</button><button onClick={()=>onNavigate('mortgage')}>Hypothèque</button><button onClick={()=>onNavigate('property')}>Nouveau bien</button><button disabled>Voiture<small>À préparer</small></button></div></section>;}
