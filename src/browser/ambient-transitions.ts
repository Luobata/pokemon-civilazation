// V11 (review 3-audio-visual): day / night and weather no longer switch instantly. The game loop shows this tracker
// each PlayerView it draws; when night or a weather field changes from one view to the next, it returns non-blocking
// fade tracks. A jump (new game, load, replay: round not advancing by at most one) is adopted without a fade.
import type { PlayerView } from '../core/model.ts';
import { nightTrack, weatherFadeTrack } from './render/animation.ts';
import type { Track } from './render/animation.ts';
import { sceneWeather } from './render/scene.ts';
import type { SceneWeather } from './render/scene.ts';

export class AmbientTransitions {
  private last: { round: number; seq: number; night: boolean; weather: Map<string, SceneWeather> } | null = null;

  reset(): void { this.last = null; }

  /** Fade tracks for what changed since the previous view (none on the first view or after a jump). */
  update(view: PlayerView): Track[] {
    // Night and weather only change with a command: most frames return at once.
    if (this.last && this.last.seq === view.commandSeq && this.last.round === view.round) return [];
    const night = view.expansion?.eraAbilities?.night ?? false;
    const weather = new Map(sceneWeather(view).map(field => [field.key, field]));
    const last = this.last;
    this.last = { round: view.round, seq: view.commandSeq, night, weather };
    if (!last || view.commandSeq < last.seq || view.round < last.round || view.round > last.round + 1) return [];
    const tracks: Track[] = [];
    if (night !== last.night) tracks.push(nightTrack(night ? 0 : 1, night ? 1 : 0));
    for (const key of weather.keys()) if (!last.weather.has(key)) tracks.push(weatherFadeTrack(key, 'in'));
    for (const [key, field] of last.weather) if (!weather.has(key)) tracks.push(weatherFadeTrack(key, 'out', field));
    return tracks;
  }
}
