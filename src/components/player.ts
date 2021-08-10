import ytdl from 'ytdl-core';
import { Readable } from 'stream';
import { Message, VoiceBroadcast, VoiceConnection } from 'discord.js';
import { ICommand, IMetadataProvider } from '../../main';
import { Observable } from '../util/observable';
import delay from '../util/delay';

interface ISong {
  title: string;
  url: string;
}

interface IPlaylist {
  songs: ISong[];
}

interface IPlayer {
  songIndex: number;
  currentSong: Observable<Readable | VoiceBroadcast>;
}

type Playlist = IPlaylist & IPlayer;

export class Player {
  constructor(metadata: IMetadataProvider) {
    this.metadataProvider = metadata;
  }

  private metadataProvider: IMetadataProvider;
  private playlists: Record<string, Playlist> = {};

  async play(message: Message, args: string[]) {
    const playlist = this.getCurrentPlaylist();

    const userVoiceChannel = message.member.voiceChannel;
    if (!userVoiceChannel) return message.channel.send(
      'You need to be in a voice channel to use this command.'
    );

    const songInfo = await ytdl.getInfo(args[0]);
    const title = songInfo.videoDetails.title
    const url = songInfo.videoDetails.video_url
    playlist.songs.push({
      title,
      url,
    });

    if (playlist.songs.length > 1) {
      return message.channel.send(`Added to queue: "${title}"`);
    }

    const newVoiceConnection = await userVoiceChannel.join();

    this.setup(message, newVoiceConnection);

    console.time(playlist.songs[playlist.songIndex].title);
    playlist.currentSong.value = newVoiceConnection.playStream(
      ytdl(playlist.songs[0].url)
    ).stream;
  }

  changeVol(message: Message, args: string[]) {
    this.getCurrentVoiceChannel()?.dispatcher.setVolume(parseFloat(args[0]))
    message.channel.send(`Volume has been set to: ${args[0]}`)
  }

  stop() {
    const playlist = this.getCurrentPlaylist();
    this.getCurrentVoiceChannel()?.disconnect();
    playlist.songs = [];
    playlist.songIndex = 0;
    playlist.currentSong.unsubscribeAll();
    playlist.currentSong.value?.removeAllListeners();
    playlist.currentSong.value?.destroy();
  }

  pause(message: Message) {
    if (this.getCurrentVoiceChannel()?.dispatcher.paused) return
    const playlist = this.getCurrentPlaylist()
    if (playlist.songs.length > 0) this.getCurrentVoiceChannel()?.dispatcher.pause()
    message.channel.send('Paused!')
  }

  resume(message: Message) {
    if (!this.getCurrentVoiceChannel()?.dispatcher.paused) return
    this.getCurrentVoiceChannel()?.dispatcher.resume()
    message.channel.send('Resuming.')
  }

  queue(message: Message) {
    const playlist = this.getCurrentPlaylist();

    const msg = playlist.songs.reduce((msg, song, index) => {
      const songName = index === playlist.songIndex ? `${song.title.split('').map(_ => '=').join('')}
${index + 1} ${song.title}
${song.title.split('').map(_ => '=').join('')}` : `${index + 1}: ${song.title}`;

      if (msg === '') {
        return `${songName}`
      }

      return `${msg}
${songName}
`
    }, '');

    message.channel.send(msg);
  }

  private setup(message: Message, voiceConnection: VoiceConnection) {
    const playlist = this.getCurrentPlaylist();

    playlist.currentSong.subscribe((stream: Readable | VoiceBroadcast) => {
      message.channel.send(`Now playing: "${playlist.songs[playlist.songIndex].title}".`);
      stream.addListener('end', async () => {
        console.timeEnd(playlist.songs[playlist.songIndex].title);

        await delay(3000);

        message.channel.send(`"${playlist.songs[playlist.songIndex].title}" has finished.`);
        if (playlist.songIndex === playlist.songs.length - 1) {
          this.stop();
        } else {
          playlist.songIndex = playlist.songIndex + 1
          console.time(playlist.songs[playlist.songIndex].title);
          playlist.currentSong.value = voiceConnection.playStream(
            ytdl(playlist.songs[playlist.songIndex].url, {
              quality: 'highestaudio',
            })
          ).stream;
        }
      })
    })
  }

  private getCurrentPlaylist(): Playlist {
    const guildId = this.metadataProvider.getGuildId();
    const playlist = this.playlists[guildId]
    if (playlist) {
      return playlist;
    } else {
      this.playlists[guildId] = {
        songs: [],
        songIndex: 0,
        currentSong: new Observable(null as any),
      }
      return this.playlists[guildId];
    }
  }

  private getCurrentVoiceChannel(): VoiceConnection | undefined {
    const guildId = this.metadataProvider.getGuildId();
    const voiceConnections = this.metadataProvider.getVoiceConnections();
    const voiceChannel = voiceConnections.find(voiceConnection => {
      return voiceConnection.channel.guild.id === guildId
    });
    return voiceChannel;
  }

  static getCommands(): ICommand[] {
    return [
      {
        shortVerb: 'p',
        verb: 'play',
        action: (instance: Player) =>
          (message: Message, args: string[]) => {
            instance.play(message, args);
          }
      },
      {
        shortVerb: 'vol',
        verb:'volume',
        action: (instance: Player) =>
          (message: Message, args: string[]) => {
            instance.changeVol(message, args);
          }
      },
      {
        verb: 'pause',
        action: (instance: Player) =>
          (message: Message) => {
            instance.pause(message);
          }
      },
      {
        verb: 'resume',
        action: (instance: Player) =>
          (message: Message) => {
            instance.resume(message);
          }
      },
      {
        shortVerb: 's',
        verb: 'stop',
        action: (instance: Player) =>
          () => {
            instance.stop();
          }
      },
      {
        shortVerb: 'q',
        verb: 'queue',
        action: (instance: Player) =>
          (message: Message) => {
            instance.queue(message);
          }
      } as any,
    ];
  }
}
