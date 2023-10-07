import minimist from 'minimist'
import CoreStore from 'corestore';
import ram from 'random-access-memory'
import AutoBase from 'autobase'
import HyperSwarm from 'hyperswarm'

const args = minimist(process.argv.slice(2), {
    alias: {
        writers: 'w',
        indexes: 'i',
        storage: 's',
        name: 'n'
    },
    default: {
        swarm: true
    },
    boolean: ['ram', 'swarm']
});

export default class HyperNews {
    constructor() {
        this.store = new CoreStore(args.ram ? ram : (args.storage || 'hypernews')) //
        this.swarm = null //
        this.autobase = null //
        this.bee = null
        this.name = null //
    }
    async start() {
        const writer = this.store.get({ name: 'writer' })
        const viewOutput = this.store.get({ name: 'view' })
        await writer.ready()
        // read name from script or use the writer's key -- core.key
        this.name = args.name || writer.key.slice(0, 8).toString('hex')
        this.autobase = new AutoBase({
            inputs: [writer],
            localInput: writer,
            outputs: [viewOutput],
            localOutput: viewOutput,
        })

        // add more input cores to autobase via the node process
        for (const w of [].concat(args.writers || [])) {
            await this.autobase.addInput(this.store.get(Buffer.from(w, 'hex')))
        }

       // add more output cores to autobase via the node process
        for (const i of [].concat(args.indexes || [])) {
            await this.autobase.addOutput(this.store.get(Buffer.from(i, 'hex')))
        }

        await this.autobase.ready()

        if (args.swarm) {
            const hash = crypto.createHash('sha256');
            hash.update(this.name);
            const hashedName = hash.digest('hex');
            const topic = Buffer.from(hashedName, 'hex')
            this.swarm = new HyperSwarm()
            this.swarm.on('connection', (socket) => this.store.replicate(socket))
            this.swarm.join(topic)
            await this.swarm.flush()
            process.once('SIGINT', () => this.swarm.destroy()) // for faster restarts
        }

        this.info();

    }

    info () {

    }
}

// const news = new HyperNews()

