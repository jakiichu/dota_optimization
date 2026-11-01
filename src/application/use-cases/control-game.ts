import type { GameControl } from '../ports/game-control.port.ts';

export class ControlGame {
  private pending: 'starting' | 'closing' | null = null;
  private deadline = 0;
  private issuing = false;
  private error: string | null = null;

  private readonly game: GameControl;
  private readonly now: () => number;

  constructor(game: GameControl, now = () => Date.now()) {
    this.game = game;
    this.now = now;
  }

  async status(): Promise<{
    phase: 'running' | 'stopped' | 'starting' | 'closing';
    error: string | null;
  }> {
    const running = await this.game.isRunning();
    if (!this.issuing && this.pending !== null) {
      if ((this.pending === 'starting') === running) this.pending = null;
      else if (this.now() >= this.deadline) {
        this.error =
          this.pending === 'starting'
            ? 'Dota не запустилась. Проверьте Steam и повторите запуск.'
            : 'Dota не закрылась. Завершите игру через её меню.';
        this.pending = null;
      }
    }
    return { phase: this.pending ?? (running ? 'running' : 'stopped'), error: this.error };
  }

  async execute(action: 'open' | 'close'): Promise<void> {
    if (this.pending || this.issuing) throw new Error('Дождитесь завершения предыдущей команды.');
    this.issuing = true;
    this.error = null;
    this.pending = action === 'open' ? 'starting' : 'closing';
    try {
      const running = await this.game.isRunning();
      if (running === (action === 'open')) {
        this.pending = null;
        return;
      }
      if (action === 'open') await this.game.open();
      else await this.game.close();
      this.deadline = this.now() + (action === 'open' ? 180_000 : 15_000);
    } catch (error) {
      this.pending = null;
      throw error;
    } finally {
      this.issuing = false;
    }
  }
}
