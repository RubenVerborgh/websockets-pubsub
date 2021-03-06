import * as http from 'http'
import Debug from 'debug'
import { BlobTreeInMem, BlobTree, WacLdp, QuadAndBlobStore, NssCompatResourceStore, DefaultOperationFactory, AclBasedAuthorizer, StoreManager } from 'wac-ldp'
import * as WebSocket from 'ws'
import { Hub } from './lib/hub'
import IResourceStore from 'solid-server-ts/src/ldp/IResourceStore'

const debug = Debug('server')
const dataDir = process.env.DATA_DIR || './data'

export class Server {
  wacLdp: WacLdp
  server: http.Server
  hub: Hub
  port: number
  wsServer: any
  owner: URL | undefined
  constructor (port: number, aud: string, owner: URL | undefined) {
    this.port = port
    const lowLevelResourceStore: IResourceStore = new NssCompatResourceStore(dataDir)
    const midLevelResourceStore: IResourceStore = new QuadAndBlobStore(lowLevelResourceStore as BlobTree) // singleton on-disk storage
    const serverRootDomain: string = new URL(aud).host
    const highLevelResourceStore: IResourceStore = new StoreManager(serverRootDomain, midLevelResourceStore as QuadAndBlobStore)
    const operationFactory = new DefaultOperationFactory(highLevelResourceStore)
    const authorizer = new AclBasedAuthorizer(highLevelResourceStore as StoreManager)

    const skipWac = (owner === undefined)
    this.wacLdp = new WacLdp(operationFactory, authorizer, {
      storage: midLevelResourceStore as QuadAndBlobStore,
      aud,
      updatesViaUrl: new URL(`ws://localhost:${this.port}/`),
      skipWac,
      idpHost: `localhost:${this.port}`,
      usesHttps: false
    })
    this.server = http.createServer(this.wacLdp.handler.bind(this.wacLdp))
    this.wsServer = new WebSocket.Server({
      server: this.server
    })
    this.hub = new Hub(this.wacLdp, aud)
    this.owner = owner
    this.wsServer.on('connection', this.hub.handleConnection.bind(this.hub))
    this.wacLdp.on('change', (event: { url: URL }) => {
      debug('change event from this.wacLdp!', event.url)
      this.hub.publishChange(event.url)
    })
  }
  async listen () {
    if (this.owner) {
      await this.wacLdp.setRootAcl(new URL(`https://localhost:${this.port}`), this.owner)
    }
    this.server.listen(this.port)
    debug('listening on port', this.port)
  }
  close () {
    this.server.close()
    this.wsServer.close()
    debug('closing port', this.port)
  }
}

// // on startup:
// const port = parseInt((process.env.PORT ? process.env.PORT : ''), 10) || 8080

// const aud = process.env.AUD || 'https://localhost:8443'
// const server = new Server(port, aud)
// server.listen()
// // server.close()

// export function closeServer () {
//   debug('closing server')
//   server.close()
// }
