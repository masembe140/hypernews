import minimist from 'minimist'
import CoreStore from 'corestore';
import ram from 'random-access-memory'
import AutoBase from 'autobase'
import HyperSwarm from 'hyperswarm'
import HyperBee from 'hyperbee'
//
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


//
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
        const self = this
        this.autobase.start({
            unwrap:true,
            async apply(view, batch){
                const beeBatch = self.bee.batch({update: false})
                for(const node of batch){
                    const nodeValue = JSON.parse(node.value)
                    const hash = crypto.createHash('sha256');
                    hash.update(nodeValue.data);

                    if(nodeValue.type === 'post'){
                        await beeBatch.put(`post${hash}`,{
                            hash,
                            votes:0,
                            data: nodeValue.data
                        })
                    }

                    if(nodeValue.type === 'vote'){
                        const increment = nodeValue?.up ? 1:-1
                        const theBee = await self.bee.get(`post${hash}`,{
                            update: false
                        })
                        if(theBee){
                            theBee.value.votes += increment
                        }
                        await theBee.put(`post${hash}`,theBee.value)

                    }
                }
            }
        })

        this.bee = new HyperBee(this.autobase.view, {
            extension: false,
            valueEncoding: "json",
            keyEncoding: 'utf-8'
        })

    }

    info () {

    }
}
//
// // const news = new HyperNews()
//

