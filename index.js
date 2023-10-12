import minimist from 'minimist'
import CoreStore from 'corestore';
import ram from 'random-access-memory'
import AutoBase from 'autobase'
import HyperSwarm from 'hyperswarm'
import HyperBee from 'hyperbee'
import crypto from 'crypto'
import lexint from 'lexicographic-integer'
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
function sha256(value) {
    const hash = crypto.createHash('sha256');
    hash.update(value);
    return hash.digest('hex');
}
class HyperNews {
    constructor() {
        this.store = new CoreStore(args.ram ? ram : (args.storage || 'hypernews')) //
        this.swarm = null //
        this.autobase = null //
        this.bee = null
        this.name = null //
    }
    async start() {
        const writer = this.store.get({name: 'writer'})
        const viewOutput = this.store.get({name: 'view', valueEncoding: 'json'})
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
            const topic = Buffer.from(sha256(this.name), 'hex')
            this.swarm = new HyperSwarm()
            this.swarm.on('connection', (socket) => this.store.replicate(socket))
            this.swarm.join(topic)
            await this.swarm.flush()
            process.once('SIGINT', () => this.swarm.destroy()) // for faster restarts
        }
        this.info();
        const self = this
        this.autobase.start({
            unwrap: true,
            async apply(view, batch) {
                const beeBatch = self.bee.batch({update: false})
                for (const node of batch) {
                    const nodeValue = JSON.parse(node.value)

                    if (nodeValue.type === 'post') {
                        const hash = sha256(nodeValue.data);
                        await beeBatch.put(`post!${hash}`, {
                            hash,
                            votes: 0,
                            data: nodeValue.data
                        })
                        await beeBatch.put('top!' + lexint.pack(0, 'hex') + '!' + hash, hash)
                    }
                    if (nodeValue.type === 'vote') {
                        const hash = nodeValue.hash;
                        const increment = nodeValue?.up ? 1 : -1
                        const blockEntryNode = await self.bee.get(`post!${hash}`, {
                            update: false
                        })
                        await beeBatch.del('top!' + lexint.pack(blockEntryNode.value.votes, 'hex') + '!' + hash)

                        if (blockEntryNode) {
                            blockEntryNode.value.votes += increment
                        }
                        await beeBatch.put(`post!${hash}`, blockEntryNode.value)
                        await beeBatch.put('top!' + lexint.pack(blockEntryNode.value.votes, 'hex') + '!' + hash, hash)
                    }
                }
                await beeBatch.flush()
            }
        })
        this.bee = new HyperBee(this.autobase.view.unwrap(), {
            extension: false,
            valueEncoding: "json",
            keyEncoding: 'utf-8'
        })
    }
    info() {
        console.log('Autobase setup. Pass this to run this same setup in another instance:')
        console.log()
        console.log('hrepl index.js '+
            '-n ' + this.name + ' ' +
            this.autobase.inputs.map(i => '-w ' + i.key.toString('hex')).join(' ') + ' ' +
            this.autobase.outputs.map(i => '-i ' + i.key.toString('hex')).join(' ')
        )
        console.log()
        console.log('To use another storage directory use --storage ./another')
        console.log('To disable swarming add --no-swarm')
        console.log()
    }
    // async all() {
    //     const res= [];
    //     for await (const data of this.bee.createReadStream({gt: 'post!', lt: 'post!~'})) {
    //         res.push(data.value)
    //     }
    //     return res;
    // }
    async * all () {
        for await (const data of this.bee.createReadStream({ gt: 'post!', lt: 'post!~' })) {
            yield data.value
        }
    }
    async * top () {
        for await (const data of this.bee.createReadStream({ gt: 'top!', lt: 'top!~', reverse: true })) {
            const { value } = (await this.bee.get('post!' + data.value))
            yield value
        }
    }
    async addPost(data) {
        const hash = sha256(data)
        this.autobase.append(JSON.stringify({
            type: 'post',
            hash,
            data
        }))
    }
    async upVote(hash) {
        this.autobase.append(JSON.stringify({
            type: 'vote',
            hash,
            up: true
        }))
    }
    async downVote(hash) {
        this.autobase.append(JSON.stringify({
            type: 'vote',
            hash,
            up: false
        }))
    }
}
export const news = new HyperNews()
await news.start()

