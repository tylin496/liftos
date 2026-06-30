import { targetsFromConfig, type NutritionConfig } from "./api";

export function ProgramsView({ config }: { config: NutritionConfig }) {
  const targets = targetsFromConfig(config);

  return (
    <section className="page-card">
      <div className="section-head">
        <p className="page-eyebrow" style={{ margin: 0 }}>Program</p>
      </div>

      <div className="nutri-prog-summary">
        <div className="nutri-prog-item">
          <span className="nutri-prog-val">{targets.calorieTarget.toLocaleString()}</span>
          <span className="nutri-prog-label">Cal Target</span>
        </div>
        <div className="nutri-prog-item">
          <span className="nutri-prog-val">{targets.proteinTarget}</span>
          <span className="nutri-prog-label">Protein Target</span>
        </div>
        <div className="nutri-prog-item">
          <span className="nutri-prog-val">{config.tdee.toLocaleString()}</span>
          <span className="nutri-prog-label">TDEE</span>
        </div>
        <div className="nutri-prog-item">
          <span className="nutri-prog-val is-text">{targets.cutPhaseName}</span>
          <span className="nutri-prog-label">Phase</span>
        </div>
      </div>
    </section>
  );
}
