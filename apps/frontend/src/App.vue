<script setup lang="ts">
import { RouterView } from 'vue-router';
import Toast from 'primevue/toast'
import { ConfirmDialog } from 'primevue';
</script>

<template>
<Toast position="top-right"/>
<ConfirmDialog />
<RouterView/>
</template>