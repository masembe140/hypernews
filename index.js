import minimist from 'minimist';

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

console.log('Received arguments:');
console.log(args);
